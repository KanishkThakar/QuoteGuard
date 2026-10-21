"""Controlled repeated measurements. Recorded real response, no public API calls or delays."""

import os, sys, json, hashlib, platform, time, statistics, argparse
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django

django.setup()
from quotes import rates, cache
from quotes.pricing import calculate, scenarios
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--samples", type=int, default=100)
parser.add_argument(
    "--output",
    default=str(Path(__file__).resolve().parents[2] / "outputs/team-delivery/function-benchmark.json"),
)
args = parser.parse_args()
if not 10 <= args.samples <= 10000:
    raise SystemExit("Use 10 to 10000 samples.")
raw = (ROOT / "evidence/frankfurter-inr-usd.json").read_bytes()
provenance = json.loads(
    (ROOT / "evidence/frankfurter-inr-usd.provenance.json").read_text()
)
assert hashlib.sha256(raw).hexdigest() == provenance["sha256"]
requests_count = 0


def provider(home, billing, requested=None):
    global requests_count
    requests_count += 1
    row = json.loads(raw, parse_float=str)
    return {
        "rate": row["rate"],
        "requested_date": "latest",
        "actual_date": row["date"],
        "source": "Recorded original Frankfurter / ECB response",
        "fetched_at": provenance["capture_time_utc"],
        "response_sha256": provenance["sha256"],
        "response": raw.decode(),
        "version": "recorded-" + provenance["sha256"],
    }


def sample(fn):
    for _ in range(5):
        fn()
    samples = []
    for _ in range(args.samples):
        start = time.perf_counter_ns()
        fn()
        samples.append((time.perf_counter_ns() - start) / 1e6)
    ordered = sorted(samples)
    return {
        "samples": len(samples),
        "warmup": 5,
        "median_ms": statistics.median(samples),
        "p95_ms": ordered[__import__("math").ceil(0.95 * len(ordered)) - 1],
        "raw_ms": samples,
    }


# Preserve and restore the normal shared rate key. Dedicated bench keys avoid user input namespaces.
bench = "qg:benchmark:recorded:INR:USD"
results = {}
with (
    patch.object(rates, "key", lambda *a: bench),
    patch.object(rates, "fetch", provider),
):
    cache.connection().delete(bench, bench + ":lock")
    before = requests_count
    # Same lookup path, forced refresh to measure a source lookup and persistence each time.
    results["recorded_rate_uncached"] = sample(
        lambda: rates.lookup("INR", "USD", refresh=True, owner="benchmark")
    )
    results["recorded_rate_uncached"]["recorded_provider_calls"] = (
        requests_count - before
    )
    rates.lookup("INR", "USD")
    before = requests_count
    results["recorded_rate_cached"] = sample(
        lambda: rates.lookup("INR", "USD", owner="benchmark")
    )
    results["recorded_rate_cached"]["recorded_provider_calls"] = requests_count - before
costs = [
    {
        "description": f"Synthetic cost {i}",
        "quantity": "1.125",
        "unit_cost": str(1000 + i),
    }
    for i in range(30)
]
inputs = {
    "costs": costs,
    "margin": ".30",
    "fee": ".029",
    "fixed": ".30",
    "rate": str(json.loads(raw)["rate"]),
    "currency": "USD",
    "proposed": None,
}


def work():
    row = calculate(**inputs)
    row["scenarios"] = scenarios(
        costs, ".30", ".029", ".30", inputs["rate"], "USD", row["gross_price"]
    )
    return row


ck = (
    "qg:benchmark:calculation:"
    + hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
)
expected = work()
cache.set_value(ck, expected, 300)


def cached():
    r = cache.get(ck)
    if r is None:
        r = work()
        cache.set_value(ck, r, 300)
    assert r == expected
    return r


results["calculation_uncached"] = sample(work)
results["calculation_cached"] = sample(cached)
cache.connection().delete(bench, bench + ":lock", ck)
output = {
    "measured_at": datetime.now(timezone.utc).isoformat(),
    "experiment": "CONTROLLED LOCAL RECORDED-RESPONSE PROVIDER; not public API latency; no simulated delay",
    "environment": {
        "platform": platform.platform(),
        "python": platform.python_version(),
        "redis": cache.connection().info()["redis_version"],
        "django": django.get_version(),
        "dataset_cost_items": 30,
        "rate_evidence": provenance,
    },
    "policy": "5 warmups per condition, same inputs; sequential measured loops. Rate baseline forces refresh including persistence; cached lookup bypasses provider and persistence. Calculations compare same 30 cost items plus five scenarios, including Redis I/O overhead. No external requests. Results may show Redis overhead exceeds calculation savings.",
    "results": results,
    "public_upstream_requests": 0,
}
p = Path(args.output)
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps(output, indent=2))
print(
    json.dumps(
        {k: {x: v for x, v in r.items() if x != "raw_ms"} for k, r in results.items()},
        indent=2,
    )
)
