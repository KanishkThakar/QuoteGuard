# QuoteGuard team instructions

Keep work local unless the user explicitly authorizes a commit or push. Never create a remote, change Git author identity or bypass the local push guard without explicit authorization. Kanishk's backend, Dhruvil's frontend and Aarav's testing files are published. Sai's setup and documentation complete the shared checkout. Preserve existing contributor history and limit commits to the scope the user authorizes.

Kanishk Thakkar owns the backend, pricing, Redis behavior and final integration. Dhruvil Shah owns frontend flows and UI screenshots. Aarav Sheth owns browser tests, benchmarks and verification evidence. Sai Sankhe owns setup, infrastructure, README and demo documentation. Keep their package paths separate. Existing code and AI-assisted handoffs are not evidence of individual authorship; members must understand and verify their own changes before submitting.

Topic 6 requires a Redis-cached endpoint, before/after endpoint timings and invalidation when source data changes. Use the original recorded provider for repeated local measurements, never load test the public API, and never inject delays to fabricate a speedup. Explain hits/misses, TTL, invalidation and Django per-view versus low-level caching. Label direct redis-py usage accurately.

Read README.md and docs/testing.md for current setup and validation. All members must understand all parts for the ten-minute demo and five-minute question session. Kanishk carries final integration responsibility; keep the other workloads broadly balanced without allocation percentages.

Save generated deliverables under /Users/kanishkthakar/Codex/projects/quoteguard-team/outputs/ and intermediates under its sibling work/ folder. On another machine choose equivalent local folders outside the checkout and outside iCloud Desktop/Documents. Set QUOTEGUARD_OUTPUTS and QUOTEGUARD_WORK for browser checks.
