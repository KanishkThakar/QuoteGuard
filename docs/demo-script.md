# Ten minute group demonstration

Use synthetic business records. State whether rates are live or recorded; the reproducible offline demo uses the original recorded Frankfurter response. Rehearse all parts together before submission.

| Time | Presenter | Action and explanation |
|---|---|---|
| 0:00–1:00 | Kanishk Thakkar | Explain the freelancer quotation problem and React → Django → PostgreSQL/Redis architecture. |
| 1:00–2:00 | Kanishk Thakkar | Explain Decimal pricing, currency rounding, fee treatment and margin rather than markup. |
| 2:00–3:30 | Kanishk Thakkar | Run a first calculation and repeat. Explain rate and calculation cache keys, owner isolation and TTL. |
| 3:30–5:00 | Kanishk Thakkar | Edit a source cost, save and recalculate. Explain version invalidation, concurrency conflicts and immutable snapshots. |
| 5:00–6:00 | Dhruvil Shah | Walk through quote/client workflow and the Cache Lab lifecycle guide. Show cold then warm results. |
| 6:00–7:00 | Dhruvil Shah | Show TTL expiry, source provenance, a phone layout and explicit conflict reload. Distinguish server timing from HTTP benchmark timing. |
| 7:00–8:00 | Aarav Sheth | Show uncached/cold/warm HTTP results, raw samples, source hash, warmups and provider counts. Report the small median benefit and worse warm p95 honestly. |
| 8:00–9:00 | Aarav Sheth | Show regression checks, owner isolation, stale-state recovery, actual Redis outage/restoration and frozen snapshot verification. |
| 9:00–10:00 | Sai Sankhe | Show Docker service health, configurable local ports, README research answers and reproducible commands. Explain remaining limitations. |

## Five minutes of questions

Every member should be able to explain any part: hit versus miss; TTL versus invalidation; why versioned obsolete keys need not be immediately deleted; per-view versus low-level caching; why recorded latency differs from live network latency; how CSRF and ownership protect records; why snapshots do not change after refresh; and why a small calculation may not benefit from Redis.

Members should use their own explanations and genuinely understand the code they review and commit. The supplied files are AI-assisted handoffs, not proof of individual authorship or comprehension.
