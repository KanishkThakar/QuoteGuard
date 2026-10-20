"""Serve the real API locally with a verified recorded upstream, never a public bypass."""

from contextlib import ExitStack, contextmanager
from datetime import date
import hashlib
import json
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

from django.conf import settings
from django.core.management import BaseCommand, CommandError, call_command

from quotes import cache, rates


class RecordedProvider:
    def __init__(self, evidence_dir):
        evidence_dir = Path(evidence_dir)
        self.raw = (evidence_dir / "frankfurter-inr-usd.json").read_bytes()
        self.provenance = json.loads(
            (evidence_dir / "frankfurter-inr-usd.provenance.json").read_text()
        )
        self.sha256 = hashlib.sha256(self.raw).hexdigest()
        if self.sha256 != self.provenance["sha256"]:
            raise CommandError("Recorded response hash does not match provenance.")
        row = json.loads(self.raw, parse_float=str)
        if row.get("base") != "INR" or row.get("quote") != "USD" or rates.D(row["rate"]) <= 0:
            raise CommandError("Expected a positive original INR/USD observation.")
        date.fromisoformat(row["date"])
        self.row = row
        self.calls = 0

    def __call__(self, home, billing, requested=None):
        if (home, billing) != ("INR", "USD") or requested is not None:
            raise rates.RateError("Recorded benchmark supports latest INR/USD only; no live fallback.")
        self.calls += 1
        return {
            "rate": str(self.row["rate"]),
            "requested_date": "latest",
            "actual_date": self.row["date"],
            "previous_available_date": False,
            "source": "Recorded original Frankfurter / ECB response; not live network latency",
            "url": self.provenance["source"],
            "fetched_at": self.provenance["capture_time_utc"],
            "response_sha256": self.sha256,
            "response": self.raw.decode(),
            "version": "recorded-" + self.sha256,
        }


@contextmanager
def recorded_mode(provider, mode):
    """Patch the server process, including its request threads, not an HTTP client."""
    if mode not in {"cached", "uncached"}:
        raise CommandError("Choose cached or uncached mode.")
    with ExitStack() as stack:
        stack.enter_context(patch.object(rates, "fetch", provider))
        if mode == "uncached":
            # Preserve the same view, pricing, auth, persistence and lock path.
            # Only rate/calculation value reads and writes are bypassed.
            stack.enter_context(patch.object(cache, "get", return_value=None))
            stack.enter_context(patch.object(cache, "set_value", return_value=False))
            stack.enter_context(patch.object(cache.Lock, "publish", return_value=False))
            stack.enter_context(patch.object(cache, "ttl", return_value=-2))
        yield


def validate_isolation():
    db = settings.DATABASES["default"]
    redis_url = urlsplit(settings.REDIS_URL)
    if not str(db["NAME"]).endswith("_benchmark") or db.get("HOST") not in {"127.0.0.1", "localhost", "::1"}:
        raise CommandError("Use a local PostgreSQL database with a name ending in _benchmark.")
    if redis_url.hostname not in {"127.0.0.1", "localhost", "::1"} or redis_url.path != "/14":
        raise CommandError("Use a dedicated local Redis instance and database 14 for benchmarking.")


class Command(BaseCommand):
    help = "Run the local recorded-response API for endpoint benchmarks (no public API requests)."

    def add_arguments(self, parser):
        parser.add_argument("--mode", choices=["cached", "uncached"], required=True)
        parser.add_argument("--port", type=int, default=8871)
        parser.add_argument("--evidence-dir", type=Path, default=Path(__file__).resolve().parents[4] / "evidence")
        parser.add_argument("--reset-cache", action="store_true", help="Delete only qg:* keys in the dedicated benchmark Redis DB 14.")

    def handle(self, *args, **options):
        validate_isolation()
        if not 1024 <= options["port"] <= 65535:
            raise CommandError("Choose an unprivileged port from 1024 to 65535.")
        try:
            provider = RecordedProvider(options["evidence_dir"])
        except (OSError, KeyError, ValueError, TypeError) as exc:
            raise CommandError(f"Invalid recorded-response evidence: {exc}") from exc
        cache.connection().ping()
        if options["reset_cache"]:
            # Snapshot matching keys before deleting; never flush shared databases.
            keys = list(cache.connection().scan_iter("qg:*"))
            for offset in range(0, len(keys), 500):
                cache.connection().delete(*keys[offset:offset + 500])
        self.stdout.write(json.dumps({"mode": options["mode"], "response_sha256": provider.sha256,
                                      "public_upstream_requests": 0, "bind": "127.0.0.1", "port": options["port"]}))
        try:
            with recorded_mode(provider, options["mode"]):
                call_command("runserver", f"127.0.0.1:{options['port']}", use_reloader=False, use_threading=False)
        finally:
            self.stdout.write(json.dumps({"recorded_provider_calls": provider.calls, "public_upstream_requests": 0}))
