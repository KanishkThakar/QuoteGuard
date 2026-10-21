# QuoteGuard: ten-minute live presentation

Tell the story of one quotation from first calculation to source change to a frozen agreement. Keep the cache behavior central. Rehearse the whole sequence once with all four members; ma'am may ask anyone about any part.

## Before class

1. Open https://quoteguard-snowy.vercel.app. Open `/api/health/` in another tab: database, Redis and application must all say `ok`.
2. Choose **Explore demo workspace**. It signs into a real account containing synthetic business records. Use a separate registered rehearsal account if you want an uncluttered workspace. Never enter real client data in the shared demo.
3. After the 22 October live walkthrough, **Launch website — live presentation** (QG-0032) is finalised. A fresh revision, **Classroom demo — ready for ma’am** (QG-0033), is prepared in the hosted demo with the inputs below. It was calculated once against the real provider and left editable. Use it if still a draft; for another rehearsal, prepare a uniquely named client, for example **Synthetic Northstar — classroom**, with USD billing. Prepare a draft titled **Launch website — live presentation**, with one INR cost of 65,000, quantity 1, a 30% target margin, 2.9% fee and 0.30 fixed USD fee. Leave it as a draft. If a prior rehearsal already finalised it, create a fresh draft; do not try to edit the frozen version.
4. Calculate once to wake free database services and confirm the real provider is reachable. Check the source and observation date. Free services can sleep; wake them before the timer starts. Keep a fresh tab ready to show the public login page.
5. Keep the local Docker fallback, benchmark JSON/report, screenshots and test results ready. Download a sample PDF before class too. Repeated benchmarks use the recorded provider locally, never the public API.
6. Put browser zoom at 100%, close unrelated tabs from the presentation window, and use a readable desktop viewport. Do not display provider dashboards, `.env` files, credentials or personal records.

## Opening line

“Ma'am, a freelancer may price a project in dollars while paying costs in rupees. A cost or reference-rate change can silently destroy the intended margin. QuoteGuard shows how Redis avoids repeated work, how we invalidate stale calculations, and why a finalised quotation must stay fixed.”

## Run of show

| Time | Presenter | Exact actions | Speaking cue and visible proof |
|---|---|---|---|
| 0:00–1:00 | Kanishk Thakar | Show login, choose **Explore demo workspace**, show dashboard, open the prepared draft through **Quotations**. | “All client records are synthetic. Live exchange observations come from Frankfurter filtered to ECB.” Point to INR cost and USD billing. |
| 1:00–2:00 | Kanishk Thakar | Click **Calculate price**, point to reference date, suggested price, fees, net revenue and margin. Click **Calculate price** again. | “We use Decimal. Margin is profit divided by net revenue, not markup.” First/warm request may already have a rate cache hit after preflight; do not call it a cold measurement. Cache Lab will demonstrate a controlled cold lookup. |
| 2:00–3:00 | Kanishk Thakar | **Edit draft** → change unit cost from 65000 to 70000 → **Save draft**. Pause at the stale notice, then calculate. | “The source input changed. The old key's version is obsolete. We preserve the foreign proposed price, so margin drops to roughly 24.6% until we deliberately reprice.” Point to stale state, then the fresh result and review notice. |
| 3:00–4:00 | Kanishk Thakar | Open the margin planner, preview 30%, then choose **Use this price in draft**. Run **Compare scenario**. | “Preview is read-only. Applying the suggestion explicitly updates the draft. The scenario changes the rate while keeping the billing amount fixed; it is hypothetical, not a forecast.” |
| 4:00–5:00 | Kanishk Thakar | **Finalise version** → download **Client PDF** and **Internal CSV**. Show PDF briefly and return to the quotation. | “This is a PostgreSQL snapshot guarded against mutation. The client PDF omits internal costs and profit. Corrections use **Create revision**.” Remember the title/quote ID for the post-refresh check. |
| 5:00–6:00 | Dhruvil Shah | Open **Cache Lab**. Click **Cold lookup** once, then **Warm lookup**. Point to result, TTL, source and version. | “This isolated demo namespace makes miss and hit visible. These server timings are individual observations, not the repeated HTTP benchmark.” Repeated Cold lookup deliberately fetches again; do not spam it. |
| 6:00–7:00 | Dhruvil Shah | **Start 3s expiry**, wait at least three seconds, **Inspect expiry**. Click **Refresh rate** once, then reopen the finalised quote; show unchanged values. Briefly show the mobile capture. | “TTL expires a key regardless of source changes. Refresh changes a rate version used by drafts. Finalised snapshots remain fixed. Obsolete versioned keys expire naturally.” Missing timing is labelled Not measured, never fabricated as zero. |
| 7:00–8:00 | Aarav Sheth | Show the latest HTTP benchmark report, raw rows and provider counts. | “Same authenticated endpoint, same quote, five warmups and 100 measured requests per condition. The upstream is the hash-verified original recorded response, with no artificial delay and zero public requests. Report actual median and p95; caching is not guaranteed to beat a small calculation.” |
| 8:00–9:00 | Aarav Sheth | Show current regression summary, source-change tests and the dedicated Redis outage/restoration report. | “Tests cover ownership, CSRF, races, rounding, snapshots, exports, responsive layout and accessibility. The outage was controlled locally; we do not stop the hosted service during class.” Distinguish passing local checks from cloud checks in the release report. |
| 9:00–10:00 | Sai Sankhe | Show README architecture and research answers; show the already-open health response and local run command. | “One repository, same-origin React/Django, persistent PostgreSQL, expendable Redis, live Frankfurter. Free tiers can sleep. Our fallback is explicitly recorded and reproducible.” Close by linking cost change → invalidation → correct draft → frozen agreement. |

If the rate does not numerically change after **Refresh rate**, that is expected: ECB observations update on their publication schedule. Show the new cache version and source timestamp. Do not claim to have changed the market rate. The cost edit is the deterministic source-change demonstration.

## Recovery while presenting

- **Rate unavailable:** acknowledge the visible error; wait briefly and retry once. Explain that the app refuses to invent a rate. If still unavailable, use the labelled local recorded-response fallback.
- **409 conflict:** click **Reload latest draft**. While editing, **Discard edits and reload** explicitly loses unsaved edits; explain that choice before using it. Recalculate after loading.
- **Free-tier cold start:** wait for health and login before beginning the timed presentation. Do not repeatedly submit the same mutation.
- **Network failure:** switch to local Docker/recorded demo, state that the upstream is recorded, show the source hash and repeat the same Redis lifecycle. Do not label the fallback a live exchange observation.
- **Existing finalised quote:** use **Create revision** or create a new draft. Never delete or mutate the original just to repeat the demonstration.

The reproducible local recorded setup and safety checks are in `testing.md`. A second local terminal runs Vite; `QUOTEGUARD_API_TARGET` selects the recorded server. The frontend can still demonstrate real Redis hit/miss/expiry and database snapshots when the provider is recorded.

## Five-minute question rehearsal

| Likely question | Explain in your own words |
|---|---|
| What is a cache hit or miss? | A hit reuses a valid value at the exact key. A miss needs more work; a lock waiter can still reuse another worker's result, so miss count and provider count differ. |
| What is TTL? | A key's finite lifetime. Here latest rates use one hour, historical rates seven days and calculations fifteen minutes; the visible three-second key is an experiment. |
| Why is invalidation hard? | Inputs and dependencies change while workers run. QuoteGuard versions the input and rate keys and rejects detected conflicting writes. Obsolete keys expire; there is no broad flush. |
| Why not Django per-view caching? | `cache_page` stores view responses. Value-level caching gives precise owner/dependency keys. We use direct redis-py for values and owned locks, not Django's configured cache backend. |
| Why is 30% margin different from 30% markup? | Margin divides profit by net revenue. Markup divides it by cost. For INR 70 cost, INR 100 net revenue is 30% margin; INR 91 revenue is 30% markup and about 23.1% margin. |
| What if two users share a quote ID? | The backend queries by both quote ID and authenticated owner; guessing another ID returns 404. A superuser using the product API still follows owner scope. |
| What does the lock guarantee? | A short, finite single-instance lease with a unique ownership token and Lua-checked publish/release. It limits stampedes but is not a multi-node Redlock implementation or perfect global exclusivity. |
| Why can cached calculations be slower? | Small Decimal calculations are cheap; serialization and a Redis round trip can cost more. Avoiding repeated external rate work is the stronger benefit. Show measured results honestly. |
| Are scenarios or quoted profits guaranteed? | No. Scenarios are hypothetical, rates are references rather than settlement promises, fees are estimates, taxes are excluded and quoted profit is not received revenue. |
| Why does finalisation survive rate refresh? | It stores the accepted calculation and quotation metadata in PostgreSQL, with database mutation guards. Redis is not the source of truth for the signed-off version. |
| Where is Django admin? | It is not enabled. Demonstrate the product UI. Superuser session checks run in the isolated test database; no shared privileged account is published. |

Every member should rehearse the formula, one cache key, one race condition and one test. AI-assisted handoff files and commit attribution are not a substitute for comprehension or genuine contribution.
