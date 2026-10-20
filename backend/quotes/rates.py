import hashlib, json, time, uuid
from datetime import date, datetime, timezone
import requests
from django.conf import settings
from . import cache
from .models import RateSnapshot
from .pricing import D, MINOR


class RateError(Exception):
    pass


def key(home, billing, requested):
    return f"qg:rate:frankfurter-ecb:{home.upper()}:{billing.upper()}:{requested or 'latest'}"


def fetch(home, billing, requested=None):
    url = f"https://api.frankfurter.dev/v2/rate/{home}/{billing}"
    params = {"providers": "ecb"}
    if requested:
        params["date"] = str(requested)
    try:
        response = requests.get(url, params=params, timeout=4)
        response.raise_for_status()
        row = json.loads(response.content, parse_float=str)
        if not isinstance(row, dict):
            raise ValueError("Invalid provider response")
        if (
            row.get("base") != home
            or row.get("quote") != billing
            or D(row["rate"]) <= 0
        ):
            raise ValueError("Invalid provider response")
        returned = date.fromisoformat(row["date"])
        if returned > date.today():
            raise ValueError("Provider returned a future observation")
        if requested and returned > date.fromisoformat(str(requested)):
            raise ValueError("Provider returned a later date")
        return {
            "rate": str(row["rate"]),
            "requested_date": str(requested or "latest"),
            "actual_date": row["date"],
            "previous_available_date": bool(
                requested and row["date"] != str(requested)
            ),
            "source": "Frankfurter / ECB reference rate",
            "url": response.url,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "response_sha256": hashlib.sha256(response.content).hexdigest(),
            "response": response.text,
            "version": uuid.uuid4().hex,
        }
    except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
        raise RateError(
            "Reference rate unavailable; no substitute rate was used."
        ) from exc


def lookup(home, billing, requested=None, refresh=False, owner=None):
    start = time.perf_counter()
    home = home.upper()
    billing = billing.upper()
    if home not in MINOR or billing not in MINOR:
        raise RateError("Unsupported currency.")
    if requested:
        try:
            requested = date.fromisoformat(str(requested)).isoformat()
        except (TypeError, ValueError) as exc:
            raise RateError("Enter a valid ISO rate date.") from exc
        if date.fromisoformat(requested) > date.today():
            raise RateError("Rate dates cannot be in the future.")
    if home == billing:
        return {
            "rate": "1",
            "version": "identity",
            "requested_date": str(requested or "latest"),
            "actual_date": str(requested or date.today()),
            "source": "Identity conversion",
            "fetched_at": None,
            "response_sha256": None,
            "previous_available_date": False,
            "cache": "identity",
            "ttl": None,
            "duration_ms": 0,
        }
    k = key(home, billing, requested)

    def cached_row():
        row = cache.get(k)
        try:
            return (
                row if row and row.get("version") and D(row.get("rate")) > 0 else None
            )
        except ValueError:
            return None

    old = cached_row()
    if old and not refresh:
        cache.metric(owner, "hit", (time.perf_counter() - start) * 1000)
        return {
            **old,
            "cache": "hit",
            "ttl": cache.ttl(k),
            "duration_ms": (time.perf_counter() - start) * 1000,
        }
    cache.metric(owner, "miss")
    lock = cache.Lock(k + ":lock")
    if not lock.acquire():
        ready = cached_row()
        if ready and (not refresh or not old or ready["version"] != old["version"]):
            return {
                **ready,
                "cache": "hit-after-wait",
                "ttl": cache.ttl(k),
                "duration_ms": (time.perf_counter() - start) * 1000,
            }
        raise RateError("Rate refresh is busy. Please retry shortly.")
    try:
        # Recheck after lock acquisition: another worker may already have filled it.
        ready = cached_row()
        if ready and (not refresh or (old and ready["version"] != old["version"])):
            return {
                **ready,
                "cache": "hit-after-wait",
                "ttl": cache.ttl(k),
                "duration_ms": (time.perf_counter() - start) * 1000,
            }
        cache.metric(owner, "upstream")
        row = fetch(home, billing, requested)
        RateSnapshot.objects.create(
            pair=f"{home}/{billing}",
            requested_date=str(requested or "latest"),
            data=row,
        )
        ttl = settings.RATE_HISTORY_TTL if requested else settings.RATE_LATEST_TTL
        stored = lock.publish(k, row, ttl)
        return {
            **row,
            "cache": "refresh" if refresh else "miss",
            "ttl": ttl if stored else None,
            "redis_available": stored,
            "duration_ms": (time.perf_counter() - start) * 1000,
        }
    finally:
        lock.release()
