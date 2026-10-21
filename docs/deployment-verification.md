# Deployment verification — 21 October 2026

**Public demo: https://quoteguard-snowy.vercel.app**. Choose **Explore demo workspace**. Only synthetic business records are present. The classroom rehearsal draft is **Launch website — live presentation**, QG-0032; it was calculated against the real Frankfurter/ECB provider and left editable.

## Release and infrastructure

The release builds on shared `main` commit `0865232969105d9897e749352b93efd5c03c5604`, preserving the published group contributions. Release work is on `codex/quoteguard-vercel-demo`; the source and README are uploaded together. The original working checkout was preserved separately.

Verified production build: `dpl_HN7hgae3T7jhGucW6kfPz3Cv2rRM`, project `quoteguard`, account `kanishk-thakar-s-projects`. Frontend: Vite/React; backend: Django on Python 3.12, configured in Singapore. Same-origin `/api/` routing preserves secure session authentication and CSRF checks. Migrations and idempotent synthetic seeding completed during the build.

| Service | Confirmed plan | Use |
|---|---|---|
| Vercel | Hobby | Frontend and Python functions |
| Neon | Free, `free_v3` | Dedicated persistent PostgreSQL, Singapore |
| Upstash | Free, $0 at setup | Dedicated TLS Redis, Singapore; 250 MB, 500,000 commands/month, 10 GB bandwidth shown at setup |

No paid plan, payment method, add-on or automatic paid upgrade was selected. The unrelated timetable database was not reused. Free quotas, service sleep and network availability still apply. Check health and wake the services before the presentation; these checks do not establish an uptime guarantee or production capacity.

## Results

| Check | Result |
|---|---|
| Backend regression, Python 3.13 | **1,206 passed**; real dedicated PostgreSQL and Redis |
| Backend regression, Python 3.12 (cloud runtime version) | **1,206 passed**, 43.52 seconds, in an isolated locked environment |
| Local browser regression | **19 passed** using the original hash-verified recorded response, with no public provider calls |
| Public HTTPS browser regression | **19 passed**, Chrome, 1.9 minutes |
| Frontend TypeScript and Vite production build | Passed locally and on Vercel |
| Locked Python dependency audit | Zero known advisories after certifi/Pillow/pytest updates |
| npm audit | Zero known vulnerabilities |
| Live health | HTTP 200; database, Redis and application all `ok` |
| Live session security | Demo login/logout, Secure and HttpOnly session cookies, Secure CSRF cookie, foreign-origin rejection, missing-CSRF rejection, private API rejected after logout |
| Local concurrent smoke check | 60/60 HTTP 200 with five workers; equal prices; zero external rate requests |
| Actual local Redis outage | Dedicated Redis stopped, direct recorded-provider calculation succeeded, Redis restarted and health restored; frozen snapshots unchanged |
| Client export inspection | Downloaded live PDF rendered and inspected; one page, legible, no internal cost/profit shown; internal CSV downloaded separately |

The 19 public browser workflows cover registration/login/logout, owner switching, empty states, optimistic conflicts and reload recovery, stale-price notices, scenario calculation, margin preview/apply, immutable snapshots, client details, revision recovery, search and keyboard focus, responsive layouts and accessibility, cold/warm lookups, real three-second expiry, live provider refresh, PDF/CSV downloads and snapshot preservation after refresh. Intercepted error responses test UI recovery; backend race tests exercise actual concurrency. No load test or outage was run against the public service.

Temporary superuser sessions were tested in the isolated test database: CSRF enforcement, owner scoping even for superusers, logout and inactive-account rejection. Django admin is not enabled; no persistent privileged account is exposed by the public demo.

## Repeated endpoint benchmark

Same authenticated endpoint, quote and body; 100 measured samples plus five excluded warmups per condition. Original recorded Frankfurter bytes; zero live public API requests and no artificial delay.

| Condition | Median | p95 |
|---|---:|---:|
| Uncached | 50.84 ms | 146.01 ms |
| Cold cache | 48.86 ms | 157.26 ms |
| Warm cache | 41.57 ms | 117.81 ms |

Warm requests made zero recorded-provider calls including warmups. The measured warm/uncached median ratio was approximately 1.22x; this is a local observation with a recorded upstream, not a promised live speedup. Financial results were equal across conditions. Forced experiment-key expiry caused misses, and changing source cost from INR 65,000 to INR 70,000 caused a miss followed by a hit with the new cost. Normal application TTLs were not shortened.

## Issues found and resolved

The first hosted health check exposed a line-wrapped Redis URL copied from the provider's code panel. The address was corrected, a direct TLS ping passed, the production environment was updated and the app redeployed. The HTTPS API setup in the browser harness also required an explicit same-origin Origin header; Django correctly rejected its original headerless mutations. The harness was corrected, preserving the application's CSRF protection, and all 19 workflows were rerun successfully.

Generated raw logs, JSON reports, screenshots and exports are outside source control under `/Users/kanishkthakar/Codex/projects/quoteguard-team/outputs/deployment-2026-10-21/`. Key evidence: `backend-tests.xml`, `local-browser-tests.log`, `live-browser-tests.log`, `live-health-security.json`, `http-benchmark.json`, `local-load-check.json`, `actual-redis-outage.json`, `python-audit.json`, `npm-audit.json`, `classroom-demo-ready.json`, and `live-browser/`. Authentication cookies and provider credentials are excluded from published evidence. Earlier verification documents remain historical.

## Interactive cache replay update — 22 October 2026

Added authenticated calculation receipts with exact lookup/result keys, input/rate versions, request IDs, actual cache decisions and provider/calculation execution flags. Cache Lab now edits a real draft cost, displays the obsolete key, retains request history and pins/verifies a finalised snapshot using full-payload SHA-256. Snapshot reads skip Redis, the provider and pricing execution. The five stages explain a completed request; they are not a streaming trace or a controlled benchmark.

Local verification: 1,210 backend tests against real PostgreSQL/Redis, six frontend unit tests, production TypeScript/Vite build and npm audit (zero vulnerabilities). The new end-to-end browser workflow verified miss/hit, cost version advance, new-key miss/following hit and immutable snapshot; accessibility and overflow checked at 320/390/768/1440 pixels. Repeated local requests used the recorded original provider, without public API load testing. Screenshots, logs and JUnit XML are retained outside the repository in the project outputs folder.
