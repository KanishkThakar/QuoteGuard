# Reproduce the Topic 6 verification

Use a dedicated PostgreSQL database ending `_benchmark` and a dedicated localhost Redis instance. The recorded server refuses other database names, remote database hosts and Redis databases other than 14. The ordinary app remains unchanged.

## Dedicated host-side environment

These example ports differ from the normal application defaults. Check for local conflicts first; do not stop another project to free a port.

```sh
docker run -d --name quoteguard-test-db -p 127.0.0.1:55434:5432 -e POSTGRES_DB=quoteguard_benchmark -e POSTGRES_USER=quoteguard -e POSTGRES_PASSWORD=local-only-quoteguard postgres:16.13-alpine
docker run -d --name quoteguard-test-redis -p 127.0.0.1:56380:6379 redis:7.4.7-alpine
export DATABASE_PORT=55434
export POSTGRES_DB=quoteguard_benchmark
export REDIS_URL=redis://127.0.0.1:56380/14
uv sync --frozen
uv run python backend/manage.py migrate --noinput
uv run python backend/manage.py seed_demo
```

The backend tests use Django's test database and Redis DB 15. The recorded server and HTTP benchmark use the dedicated benchmark database and Redis DB 14. Do not run a benchmark while another task is editing or clearing those data.

## Repeated HTTP benchmark

```sh
uv run python scripts/benchmark_http.py --samples 100 --warmups 5
```

The script starts and stops its own localhost servers on 8871 and 8872. It refuses occupied ports. It creates labelled synthetic data, verifies the original provider-response hash, and checks equivalent prices across conditions. Cold eviction happens outside the timed interval. Warmup timings are saved but excluded from median/p95. p95 uses nearest rank. Provider counts include warmups and are reported separately from measured request counts.

The source-change check updates synthetic costs. The expiry check deliberately shortens only experiment keys to 30 ms, then waits for Redis expiry; that test duration is not the application's normal TTL. Results default to the sibling `outputs/team-delivery/` directory; `--output` overrides the benchmark report path. A single run does not establish production performance or a stable speedup.

## Browser suite without public requests

Start the recorded server on port 8000, then Vite in another terminal:

```sh
uv run python backend/manage.py serve_benchmark --mode cached --port 8000 --reset-cache
# Other terminal, from repository root:
cd frontend
npm ci
npm run dev -- --port 8782 --strictPort
# Third terminal, from frontend:
QUOTEGUARD_BASE_URL=http://127.0.0.1:8782 npm run test:e2e
```

Use `QUOTEGUARD_BROWSER_CHANNEL=chrome` for installed Chrome, or install Playwright Chromium. `QUOTEGUARD_API_TARGET` can change Vite's backend address. Vite preserves the browser's Host for same-origin CSRF checks. Browser tests include a deliberately intercepted 409 response to test UI recovery; backend race tests cover actual concurrency. Screenshots use real browser renders with synthetic records. Browser reports explicitly identify recorded-versus-live provenance.

## Local load and actual Redis outage

```sh
QUOTEGUARD_BASE_URL=http://127.0.0.1:8782 uv run python scripts/check_local_load.py
uv run python scripts/check_redis_outage.py --base-url http://127.0.0.1:8782 --redis-container quoteguard-test-redis
```

Run the outage check after other tests finish. It deliberately stops the named container, checks fallback behavior and frozen snapshots, and restarts the container in a finally block. It validates that the container's loopback port matches REDIS_URL, and fails if restart health cannot be verified. Use the recorded server to avoid external requests. The load check uses an INR identity quote, 60 requests and five workers; it is not a production capacity estimate.

Stop the recorded server and Vite with Ctrl+C. Stop only the dedicated test containers when finished. Keep data until evidence is saved; do not flush shared Redis or remove unrelated volumes.

## Interactive cache replay regression

`test_cache_replay_*` in `backend/tests/test_integration.py` verifies actual Redis keys, the one-time suggested-price version advance, unique request IDs, a cost edit causing a new-key miss, the next hit, separate provider/calculation work flags, failed Redis write reporting, owner isolation and fixed full-snapshot SHA-256 after revision edits. The browser test `interactive replay shows source invalidation and a fixed finalised snapshot` exercises the complete UI and audits accessibility and overflow at 320, 390, 768 and 1440 pixels. The local browser server uses the recorded original provider; no public API is load tested.
