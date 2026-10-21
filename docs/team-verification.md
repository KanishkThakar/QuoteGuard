# Topic 6 verification — 20 October 2026

The checks ran locally against Kanishk's backend commit f5d37fa and the uncommitted team files. No teammate changes were committed or pushed. Synthetic business records and the original hash-verified recorded Frankfurter response were used; these are not live exchange-rate observations.

## Results

- Backend baseline: 1,198 tests passed in the Kanishk handoff run.
- Frontend production build passed; npm audit reported zero vulnerabilities at verification time.
- Full browser suite: 18 tests passed. After final timing-label and skip-link changes, all eight affected focus/layout/Topic 6 tests passed again. Includes automated accessibility, responsive layouts, conflict recovery and invalidation.
- HTTP benchmark: 100 measured requests per condition, five separate warmups. Uncached median 13.232 ms / p95 14.403 ms; cold median 15.176 ms / p95 19.438 ms; warm median 12.920 ms / p95 16.841 ms. Warm median benefit was small and warm p95 was slower than uncached. Do not claim a general performance speedup.
- Warm measured requests and warmups made zero provider calls after prefill. Cold and uncached each made 105 calls including warmups. All provider work was recorded locally; zero public requests.
- Explicit source-change and shortened experimental TTL checks passed. Production TTL values were not altered.
- Local INR identity load check: 60 requests, five workers, all HTTP 200; median 19.203 ms, p95 22.631 ms, maximum 23.699 ms.
- Actual dedicated Redis-container outage check passed; the container was restarted and health verified afterward.
- Docker application build, health checks and scripts/run.sh succeeded in a dedicated stack on port 8783.

## Evidence and limits

Raw benchmark, load and outage results are under docs/evidence. Browser screenshots are supplied by Dhruvil's package under docs/images. Run instructions are in testing.md supplied by Sai. ZIP review-evidence folders retain command output; they need not be committed.

Timings include local HTTP and database work with a recorded upstream and no artificial delay. A single run does not measure production capacity or live provider latency. UI conflict recovery uses a deliberately intercepted 409; backend tests cover actual races. Screenshots and test data must not be described as customer records. Historical verification documents relate to earlier runs.
