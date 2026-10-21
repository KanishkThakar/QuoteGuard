# QuoteGuard

**IMAP Topic 6 — Redis Caching and Cache Invalidation.** A Django and React quotation workspace for freelancers who enter INR costs and bill international clients. Redis caches reference-rate lookups and draft calculations; versioned keys prevent reuse after inputs or the source rate change. Finalised quotations are immutable PostgreSQL snapshots.

## Team responsibilities

| Member | Responsibility |
|---|---|
| Kanishk Thakar | Core backend, Decimal pricing, Redis behavior, authentication, data integrity and integration |
| Dhruvil Shah | Frontend workflows, Cache Lab, conflict recovery and screenshots |
| Aarav Sheth | Browser regression tests, HTTP benchmarks, load/outage checks and evidence |
| Sai Sankhe | Docker setup, documentation, research explanations and demonstration |

These are responsibility assignments. The handoff packages contain AI-assisted work and inherited project files; each member must review, understand and verify their files before making genuine commits. One repository is used for the final group submission. No individual authorship is inferred from this table.


## Live demonstration and presentation

**[Open the live demo](https://quoteguard-snowy.vercel.app)** → **Explore demo workspace**. Vercel Hobby, Neon Free PostgreSQL and Upstash Free Redis; no paid plan or add-on was selected. [Release checks and limits](docs/deployment-verification.md).

The release passed 1,206 backend tests, 19 local browser workflows and the same 19 workflows on the public HTTPS deployment. The live checks include mobile/accessibility, real reference-rate lookups, cache expiry/invalidation, PDF/CSV downloads and immutable finalised snapshots.

Choose **Explore demo workspace** on the sign-in page to open the real synthetic demo account, or register a separate account for your own rehearsal. The demonstration includes client creation, fee-aware pricing, hypothetical scenarios, margin planning, search, cache experiments, finalisation, PDF/CSV downloads and revisions. The shared demo may contain other rehearsals; give your new quotation a unique title.

For ma'am: follow the [minute-by-minute presentation script](docs/demo-script.md), including the preflight, exact clicks, speaking cues, member handoffs and five-minute question rehearsal. The main story is: **a freelancer changes a project cost; the old cached answer becomes stale; a fresh calculation protects the margin while the signed-off quotation remains frozen.**

## Interactive cache replay

**Cache Lab → Follow the answer** explains a real request through five clickable stages: **Request → key/version → hit or miss → provider/calculation → response**. Run a draft, change its first cost inside the lab, save the new input version, then run twice to observe the new-key miss followed by a hit. Expand the actual request history to inspect the keys and server receipt. A separate finalised-quotation panel pins and verifies the full snapshot SHA-256, proving the signed-off price stays fixed after draft edits.

Old keys become unreachable by the updated draft and expire through TTL; they are not necessarily deleted immediately. Rate-cache and calculation-cache decisions are separate. The walkthrough explains a completed response, and the rate version is resolved before the calculation key. Observed timings are not a controlled benchmark or a guaranteed speedup. [Exact speaking cues and clicks](docs/demo-script.md#interactive-request-replay-topic-6-centerpiece).

## Assignment requirements and evidence

Checked against the supplied *IMAP_Group_Project_Topics_BTech.docx*, Topic 6 and its submission notes.

| Required item | Where to inspect it |
|---|---|
| Redis-cached endpoint | `POST /api/quotes/{id}/calculate/`, `backend/quotes/rates.py`, `backend/quotes/services.py` |
| Before/after endpoint benchmark | `scripts/benchmark_http.py`, [benchmark method](docs/testing.md), raw `docs/evidence/http-benchmark.json` |
| Invalidation after source change | Edit costs/fees then save; inspect stale notice and new version; [architecture](docs/architecture.md) and `frontend/tests/topic6.spec.ts` |
| Hit versus miss | Research answers below and Cache Lab cold/warm experiment |
| TTL and invalidation difficulty | Research answers below; real three-second expiry demonstration |
| Django per-view versus low-level caching | Research answers below; implementation uses direct redis-py explicitly |
| Frankfurter API | Real ECB-filtered rates, source date, hash and bounded failure handling |
| Architecture, setup, screenshots | This README and the linked documents |
| Ten-minute live demo plus five-minute questions | [Presentation script](docs/demo-script.md) |
| One group repository and real contributions | [Shared repository](https://github.com/KanishkThakar/QuoteGuard), responsibility table and actual commit history |
| Free tiers, no committed secrets, no public load test | [Deployment procedure](docs/deployment.md), `.env.example`, `.gitignore`, guarded loopback benchmarks |

Role assignments are not a claim of percentage contribution. Every member must explain all parts, review their work, and make genuine contributions; do not fabricate commit identity or contributions.

## Architecture

```mermaid
flowchart LR
  UI[React and TypeScript] --> Proxy[Same-origin Vercel routing or local proxy]
  Proxy --> API[Django and DRF]
  API --> DB[(PostgreSQL snapshots and ownership)]
  API --> Cache[(Redis rates and calculations)]
  API --> Provider[Frankfurter ECB reference rates]
```

Authoritative prices use Python Decimal, never frontend arithmetic. For cost C, margin m, fee fraction f, fixed fee F and exchange rate r (billing units per INR), the suggested billing amount is `(r*C/(1-m)+F)/(1-f)`, rounded upward to the currency's minor unit. Margin is profit divided by net revenue. Taxes are not calculated; reference rates are not settlement guarantees. Nonpositive revenue has an undefined margin.

## Run locally

Prerequisites: Docker with Compose v2. Clone the shared repository and run these commands from its root.

```sh
cp .env.example .env
sh scripts/run.sh
```

Open the address printed by the script (default [localhost port 8780](http://127.0.0.1:8780)). Synthetic demo credentials are `demo` / `DemoQuoteGuard!2026`; `demo_other` uses the same demo password. The seed command does not replace existing passwords. Set `WEB_PORT` and `COMPOSE_PROJECT_NAME` in `.env` if another stack is running. PostgreSQL and Redis are private by default; web binds only to loopback.

`docker compose stop` stops this stack and preserves its data. `docker compose up -d --wait` resumes it. Avoid `down -v` unless intentionally discarding the local database.

## Screenshots

Actual browser captures with synthetic business records and the original recorded INR/USD provider response. They are real browser renders with synthetic business inputs, not mockups or current market-rate observations.

![Dashboard](docs/images/dashboard-desktop.png)
![Cold lookup](docs/images/cache-cold.png)
![Warm lookup](docs/images/cache-warm.png)
![Source changed and calculation stale](docs/images/source-changed-stale.png)
![Cache Lab on a phone](docs/images/cache-mobile.png)

## Research answers

### Cache hit versus miss

A hit means the lookup finds a valid stored result under the exact key. A miss means work must be performed to obtain that result. A miss need not cause an upstream request: another worker may populate the key while this request waits for its lock. QuoteGuard records both misses and provider attempts rather than treating them as identical.

### TTL and why invalidation is hard

TTL is the remaining lifetime of a cached value. Expiry removes it even if the source has not changed. Latest rates use a one-hour TTL, historical rates seven days and calculations fifteen minutes. Those are freshness/overhead choices, not a guarantee about publication schedules.

Invalidation is difficult because data dependencies and concurrent writers must agree. A quote's costs, target, fees and reference rate may change while an old calculation is still running. QuoteGuard uses quote/input and rate versions in its keys. An old key is no longer addressed after a version change; it physically expires later. A conditional database update and final rate-version check reject detected in-flight changes with HTTP 409. Finalised snapshots stay fixed. A change occurring after a request's final check must be observed by a subsequent request; no claim of instantaneous global freshness is made.

### Django per-view versus low-level caching

Django's `cache_page` caches a view response for a specified timeout. Its low-level `django.core.cache` API lets code cache individual values with explicit keys and timeouts. QuoteGuard uses direct redis-py calls for value-level caching and owned locks, rather than configuring Django's cache backend or decorating authenticated views. Caching an owner-specific response without all relevant identity and version inputs could expose data or return stale values. See the [Django 5.2 cache framework documentation](https://docs.djangoproject.com/en/5.2/topics/cache/).

The team should explain these answers in its own words during the demonstration and relate them to `rates.py`, `services.py` and the tests.

## Verification and measurements

See [deployment verification](docs/deployment-verification.md), [earlier team verification](docs/team-verification.md), [architecture](docs/architecture.md) and [the demo script](docs/demo-script.md). Historical verification files describe earlier runs and must not be presented as new measurements. The [deployment verification record](docs/deployment-verification.md) tracks the current release separately.

The HTTP benchmark uses the same authenticated endpoint, quote and request data in uncached, cold and warm conditions. It substitutes the hash-verified original Frankfurter response inside two local server processes. It makes no public upstream requests, adds no delay, and reports raw samples separately from warmups. These timings describe local HTTP with a recorded upstream, not live Frankfurter network latency.

Run backend tests on dedicated local infrastructure:

```sh
docker compose -f compose.yaml -f compose.test.yaml up -d --wait db redis
uv sync --frozen
DATABASE_PORT=55432 REDIS_URL=redis://127.0.0.1:56379/0 uv run pytest -q
cd frontend
npm ci
npm run build
npx playwright install chromium
QUOTEGUARD_BASE_URL=http://127.0.0.1:8780 npm run test:e2e
```

For browser runs with zero live provider calls, use the recorded server setup in [testing instructions](docs/testing.md). `QUOTEGUARD_BROWSER_CHANNEL=chrome` selects installed Chrome. Set `QUOTEGUARD_OUTPUTS` and `QUOTEGUARD_WORK` to local output/work folders outside the checkout. Defaults are sibling `outputs/` and `work/` folders.

## Recovery and limits

- A 409 conflict means the quote changed; use **Reload latest draft**. While editing, **Discard edits and reload** explicitly drops unsaved changes.
- A failed provider request produces an error without invented rates. Redis failure permits bounded direct provider work; no stale fallback is implied.
- The shared demo accounts contain synthetic records only; do not enter personal or customer data. Hosted deployment requires a random secret, DEBUG=0, persistent PostgreSQL, TLS Redis, HTTPS and secure cookies. No privileged account is publicly exposed.
- Never load test a public API. Load checks are loopback-only; the outage check requires an explicit local Redis container and verifies its published port before stopping it.
- Use free services only. Keep `.env`, credentials, dependencies, caches and generated test artifacts out of commits.

## Production deployment

[Vercel Services](https://vercel.com/docs/services) (currently Beta) routes the React/Vite frontend and Django backend under one origin. Hosted PostgreSQL stores users, clients, audit events and immutable snapshots; hosted TLS Redis stores expendable rate/calculation caches and owned locks. Vercel does not run the local Compose database services for you. See [deployment steps and environment variables](docs/deployment.md).

The cloud configuration rejects a development secret, DEBUG enabled, a missing persistent PostgreSQL URL, and a non-TLS Redis URL. HTTPS redirection, secure session/CSRF cookies, HSTS and clickjacking headers protect the deployed origin. PostgreSQL migrations and the idempotent synthetic seed run at deployment build time. Preview environments must have their own credentials and isolated data; do not connect an arbitrary preview to the demo database.

Django's admin dashboard is not installed or routed. Superuser authentication is tested using temporary test-database accounts; no shared administrator password is exposed. The classroom presentation uses the product UI and its Cache Lab.

## Primary sources

- [Django cache framework](https://docs.djangoproject.com/en/5.2/topics/cache/) — per-view and value-level caching.
- [Redis distributed lock guidance](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/) — ownership tokens and bounded leases. QuoteGuard uses one Redis instance; it does not claim Redlock's multi-node guarantees.
- [Frankfurter API](https://frankfurter.dev/) — currency pair endpoints, source dates and provider filtering. QuoteGuard requests `providers=ecb`.
- [Django deployment checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/) and [Django on Vercel](https://vercel.com/docs/frameworks/full-stack/django) — hosted runtime and production configuration.
