"""Bounded loopback load check. Synthetic INR-only quote: no public rate calls."""

import concurrent.futures, json, statistics, time, os
from urllib.parse import urlsplit
from datetime import datetime, timezone
from pathlib import Path
import requests

BASE = os.environ.get("QUOTEGUARD_BASE_URL", "http://127.0.0.1:8780").rstrip("/") + "/api/"
if urlsplit(BASE).hostname not in {"127.0.0.1", "localhost", "::1"}:
    raise SystemExit("Load checks are restricted to loopback servers.")
s = requests.Session()
csrf = s.get(BASE + "auth/session/").json()["csrf"]
s.headers["X-CSRFToken"] = csrf
r = s.post(
    BASE + "auth/register/",
    json={"username": f"loadqa_{time.time_ns()}", "password": "SyntheticLoad!2026"},
)
r.raise_for_status()
s.headers["X-CSRFToken"] = r.json()["csrf"]
c = s.post(
    BASE + "clients/", json={"name": "Synthetic concurrency QA", "currency": "INR"}
)
c.raise_for_status()
q = s.post(
    BASE + "quotes/",
    json={
        "client": c.json()["id"],
        "title": "Synthetic local load check",
        "currency": "INR",
        "valid_until": "2026-12-01",
        "costs": [
            {"description": "Synthetic cost", "quantity": "1", "unit_cost": "1000"}
        ],
    },
)
q.raise_for_status()
url = BASE + f"quotes/{q.json()['id']}/calculate/"
warm = s.post(url, json={})
warm.raise_for_status()


def invoke(_):
    start = time.perf_counter()
    with requests.Session() as worker:
        worker.cookies.update(s.cookies)
        worker.headers.update({"X-CSRFToken": s.headers["X-CSRFToken"]})
        result = worker.post(url, json={}, timeout=15)
        row = result.json()
    return {
        "status": result.status_code,
        "ms": (time.perf_counter() - start) * 1000,
        "cache": row.get("calculation_cache"),
        "rate_source": row.get("rate_provenance", {}).get("source"),
        "price": row.get("gross_price"),
    }


with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    rows = list(pool.map(invoke, range(60)))
assert all(
    r["status"] == 200 and r["price"] == warm.json()["gross_price"] for r in rows
), rows
assert all(r["rate_source"] == "Identity conversion" for r in rows), rows
latency = sorted(r["ms"] for r in rows)
result = {
    "verified_at": datetime.now(timezone.utc).isoformat(),
    "samples": len(rows),
    "concurrency": 5,
    "public_rate_requests": 0,
    "synthetic_inputs": True,
    "condition": "Warm INR identity calculation against configured loopback app",
    "status_counts": {"200": len(rows)},
    "median_ms": statistics.median(latency),
    "p95_ms": latency[__import__("math").ceil(0.95 * len(latency)) - 1],
    "max_ms": max(latency),
    "rows": rows,
    "limitation": "Bounded local smoke load only; does not estimate production capacity.",
}
output = Path(os.environ.get("QUOTEGUARD_OUTPUTS", str(Path(__file__).resolve().parents[2] / "outputs/team-delivery"))) / "local-load-check.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, indent=2))
print(json.dumps({k: v for k, v in result.items() if k != "rows"}, indent=2))
