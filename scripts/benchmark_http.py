"""Reproducible local HTTP benchmark; starts recorded-provider servers itself."""
import argparse
from datetime import date, timedelta, datetime, timezone
import json
import math
import os
from pathlib import Path
import platform
import signal
import socket
import statistics
import subprocess
import sys
import time

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from quotes import cache, rates
from quotes.models import RateSnapshot
from quotes.management.commands.serve_benchmark import validate_isolation, RecordedProvider

FINANCIAL = ["cost", "gross_price", "suggested_price", "fees", "net_revenue", "profit", "margin", "rate", "scenarios"]


def summarize(rows):
    values = sorted(row["elapsed_ms"] for row in rows)
    return {"samples": len(rows), "median_ms": statistics.median(values),
            "p95_ms": values[math.ceil(.95 * len(values)) - 1], "rows": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=100)
    parser.add_argument("--warmups", type=int, default=5)
    parser.add_argument("--cached-port", type=int, default=8871)
    parser.add_argument("--uncached-port", type=int, default=8872)
    parser.add_argument("--output", type=Path, default=ROOT.parent / "outputs/team-delivery/http-benchmark.json")
    args = parser.parse_args()
    if not 10 <= args.samples <= 1000 or not 0 <= args.warmups <= 100:
        parser.error("Use 10–1000 samples and 0–100 warmups.")
    if args.cached_port == args.uncached_port or any(not 1024 <= p <= 65535 for p in [args.cached_port, args.uncached_port]):
        parser.error("Choose distinct unprivileged localhost ports.")
    validate_isolation()
    cache.connection().ping()
    provider = RecordedProvider(ROOT / "evidence")
    for port in [args.cached_port, args.uncached_port]:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", port))
    work = Path(os.environ.get("QUOTEGUARD_WORK", str(ROOT.parent / "work/http-benchmark")))
    work.mkdir(parents=True, exist_ok=True)
    servers, logs = [], []
    report = {"measured_at": datetime.now(timezone.utc).isoformat(), "source_sha256": provider.sha256,
              "experiment": "Actual loopback HTTP with a recorded original Frankfurter response; not live public API latency",
              "environment": {"python": platform.python_version(), "django": django.get_version(), "platform": platform.platform(), "redis": cache.connection().info()["redis_version"]},
              "warmups_per_condition": args.warmups, "public_upstream_requests": 0,
              "policy": "Same quote, payload and original rate bytes. Cache bypass retains authentication, persistence, locks and metrics. Cold eviction occurs before timing. No artificial delay. Only loopback servers started by this script are contacted."}
    try:
        for mode, port in [("cached", args.cached_port), ("uncached", args.uncached_port)]:
            log = (work / f"{mode}.log").open("w")
            logs.append(log)
            proc = subprocess.Popen([sys.executable, "-u", "backend/manage.py", "serve_benchmark", "--mode", mode, "--port", str(port)], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
            servers.append(proc)
            for _ in range(100):
                if proc.poll() is not None:
                    raise RuntimeError(f"{mode} server failed; inspect {log.name}")
                try:
                    r = requests.get(f"http://127.0.0.1:{port}/api/health/", timeout=1)
                    if r.ok: break
                except requests.RequestException: pass
                time.sleep(.1)
            else: raise RuntimeError("Local server did not become healthy")
        bases = {"cached": f"http://127.0.0.1:{args.cached_port}/api/", "uncached": f"http://127.0.0.1:{args.uncached_port}/api/"}
        session = requests.Session()
        def call(path, body, mode="cached", method="POST"):
            r = session.request(method, bases[mode] + path, json=body, timeout=15)
            r.raise_for_status()
            return r.json()
        first = session.get(bases['cached'] + 'auth/session/', timeout=10); first.raise_for_status()
        session.headers['X-CSRFToken'] = first.json()['csrf']
        user = call('auth/register/', {"username": f"bench_{time.time_ns()}", "password": "SyntheticBenchmark!2026"})
        session.headers['X-CSRFToken'] = user['csrf']
        client = call('clients/', {"name": "Synthetic HTTP benchmark", "currency": "USD"})
        quote = call('quotes/', {"client": client['id'], "title": "Synthetic identical-input HTTP experiment", "currency": "USD", "valid_until": str(date.today() + timedelta(days=30)), "target_margin": ".30", "fee_percent": ".029", "fixed_fee": ".30", "proposed_price": "1000", "costs": [{"description": "Synthetic workload", "quantity": "1", "unit_cost": "65000"}]})
        path = f"quotes/{quote['id']}/calculate/"
        rate_key = rates.key("INR", "USD", None)
        pattern = f"qg:calc:{user['user']['id']}:{quote['id']}:*"
        def evict():
            keys = list(cache.connection().scan_iter(pattern)) + [rate_key]
            cache.connection().delete(*keys)
        expected = None
        def measure(mode):
            nonlocal expected
            begin = time.perf_counter_ns()
            data = call(path, {"refresh": False}, mode)
            elapsed = (time.perf_counter_ns() - begin) / 1e6
            business = {k: data[k] for k in FINANCIAL}
            if expected is None: expected = business
            assert business == expected, "Business result changed between conditions"
            assert data['rate_provenance']['response_sha256'] == provider.sha256
            return {"elapsed_ms": elapsed, "calculation_cache": data['calculation_cache'], "rate_cache": data['rate_provenance']['cache']}
        report['conditions'] = {}
        for condition in ['uncached', 'cold', 'warm']:
            mode = 'uncached' if condition == 'uncached' else 'cached'
            if condition == 'warm':
                evict(); measure('cached')
            before = RateSnapshot.objects.count()
            warmups, rows = [], []
            for i in range(args.warmups + args.samples):
                if condition == 'cold': evict()
                row = measure(mode)
                expected_cache = 'hit' if condition == 'warm' else 'miss'
                assert row['calculation_cache'] == row['rate_cache'] == expected_cache, row
                (warmups if i < args.warmups else rows).append(row)
            report['conditions'][condition] = {**summarize(rows), 'warmup_rows': warmups,
                'recorded_provider_calls_including_warmups': RateSnapshot.objects.count() - before}
        # Shorten only this experiment's keys, then observe actual expiry.
        keys = list(cache.connection().scan_iter(pattern)) + [rate_key]
        for key in keys: cache.connection().pexpire(key, 30)
        deadline = time.monotonic() + 3
        while any(cache.connection().exists(key) for key in keys):
            if time.monotonic() > deadline: raise RuntimeError('TTL did not expire')
            time.sleep(.01)
        expired = measure('cached'); assert expired['calculation_cache'] == expired['rate_cache'] == 'miss'
        current = session.get(bases['cached'] + f"quotes/{quote['id']}/", timeout=10);current.raise_for_status()
        call(f"quotes/{quote['id']}/", {'version': current.json()['version'], 'costs': [{'description':'Changed synthetic source','quantity':'1','unit_cost':'70000'}]}, method='PATCH')
        changed = call(path, {'refresh':False}); repeated = call(path, {'refresh':False})
        assert changed['cost']=='70000.00' and changed['calculation_cache']=='miss' and repeated['calculation_cache']=='hit'
        report['behavior_checks'] = {'equivalent_financial_results': True, 'shortened_ttl_ms': 30, 'expiry_request': expired, 'source_change': {'before_cost':expected['cost'],'after_cost':changed['cost'],'first':changed['calculation_cache'],'repeat':repeated['calculation_cache']}}
        report['quote_id'] = quote['id']
        report['warm_vs_uncached_median_ratio'] = report['conditions']['uncached']['median_ms'] / report['conditions']['warm']['median_ms']
    finally:
        for proc in servers:
            if proc.poll() is None:
                proc.send_signal(signal.SIGINT)
                try: proc.wait(timeout=10)
                except subprocess.TimeoutExpired: proc.terminate(); proc.wait(timeout=10)
        for log in logs: log.close()
    report['server_counters'] = {}
    for mode in ['cached', 'uncached']:
        counters = [json.loads(line) for line in (work / f'{mode}.log').read_text().splitlines() if line.startswith('{"recorded_provider_calls"')]
        if not counters: raise RuntimeError('Server provider counter missing')
        report['server_counters'][mode] = counters[-1]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({name:{k:v for k,v in result.items() if k not in ['rows','warmup_rows']} for name,result in report['conditions'].items()},indent=2))


if __name__ == '__main__': main()
