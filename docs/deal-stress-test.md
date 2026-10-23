# Deal Stress Test

Open a calculated quotation and find **Negotiation desk → How far can this deal bend?**

1. Run the default scenario. It should reproduce the saved price and margin.
2. Change the discount, cost increase and exchange-rate change sliders. The previous answer clears immediately; click **Run stress test** to get the server-calculated result.
3. Inspect client price, INR profit, total costs and net revenue after fees. The outcome indicates margin protected, below target, or a nonviable deal.
4. **Find a workable deal** gives two independent alternatives: raise the client price while keeping scenario costs, or reduce costs while keeping the discounted price. A cost-only recovery requires positive net revenue. Budgets round down; minimum prices round up to the billing currency's minor unit.
5. Expand **Show the engine**. The first uncached scenario is a MISS; run it unchanged to observe a HIT. Request IDs are unique. Actual keys include owner, quote, input version and a digest of baseline, pricing inputs, scenario and engine version. Normal calculation TTL applies. Keys from older input versions are unreachable and expire later.
6. Saved drafts and finalised snapshots remain unchanged. To change the actual quote, use the existing draft editor or create a revision.

Speaking cue: “Before accepting a client's discount, we can rehearse it alongside cost and currency risk. Django calculates the resulting profit with Decimal arithmetic. If the target breaks, the app calculates a viable minimum price or maximum cost budget. Repeating the same scenario uses Redis, with the real key and decision visible.”

Positive FX changes mean more billing currency per INR. Holding the foreign client price fixed then produces fewer INR. These are hypothetical adjustments to the quotation's recorded reference rate, not live forecasts or settlement guarantees. Same-currency quotations disable FX adjustment. Stale drafts must be recalculated before scenarios run; archived quotes require a revision. No provider call is needed for a stress preview.

## Implementation

- `POST /api/quotes/{id}/stress/`: authenticated, owner-scoped, no quotation writes.
- `discount_percent`: 0–100; `cost_increase_percent`: 0–100; `rate_change_percent`: -50–50, all at most two decimal places.
- Existing payment fees and target margin are retained. Every line's unit cost rises by the selected percentage. Taxes are excluded.
- Redis failures fall back to calculation and report `cache_written: false`; they do not claim a stored result. Timing is observed endpoint work, not a performance guarantee.
- Client responses are discarded if sliders or quotation versions change while a request is in flight.

## Verification in the isolated local checkout

The feature adds backend tests for recovery math, FX direction, owner isolation, stale drafts, immutable snapshots, real Redis reuse and unavailable-cache fallback. Browser coverage checks all three controls, MISS/HIT, loss and recovery options, unchanged saved data, finalised previews, accessibility and overflow at widths 320, 390, 768 and 1440.

The local preview uses its own PostgreSQL and Redis containers and the verified recorded Frankfurter response. It is separate from the deployed demo. No schema migration, cloud configuration change, commit or deployment is required for reviewing this local feature.

## Production release

The feature is deployed at https://quoteguard-snowy.vercel.app, deployment `dpl_5bvNXVbtpSHZtSDRP4Tg4rsspQCf` (production, Ready). The public health check reported application, PostgreSQL and Redis OK. Two public browser checks passed: demo session/logout and the stress workflow, including real Redis MISS/HIT, recovery options, unchanged draft inputs, immutable finalised snapshots and responsive accessibility checks. The final local backend run passed 1,218 tests; the frontend build and six unit tests passed. No new database migration was needed.

Generated release evidence and the source hash manifest are retained outside the repository at `/Users/kanishkthakar/Codex/projects/quoteguard-team/outputs/deal-stress-production/`.
