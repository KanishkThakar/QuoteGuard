# Vercel deployment and recovery

Deploy the complete application using `vercel.json`: frontend service `frontend/` with Vite; backend service rooted at the repository, with Django WSGI entrypoint `backend.config.wsgi:application`. Services is currently Beta. Top-level routing preserves `/api/` and the same browser origin for sessions and CSRF. No frontend API credential is needed.

## Free infrastructure

The verified public alias is https://quoteguard-snowy.vercel.app. The deployed resources are Vercel **Hobby**, Neon **Free** (`free_v3`), and Upstash **Free** (Singapore; 250 MB storage, 500,000 commands/month and 10 GB bandwidth shown at setup). No paid plan, payment method or automatic paid upgrade was selected.

The assignment requires free tiers only. Use a dedicated Neon Free PostgreSQL database and a dedicated free TLS Redis database created directly in Upstash if available. The Vercel marketplace may list only paid Upstash plans; do not select those or enable automatic paid upgrades. Do not reuse an unrelated project's database. Free quotas and sleep/cold starts apply; verify provider dashboards before presenting. No uptime guarantee is implied.

## Environment

| Variable | Production value or rule |
|---|---|
| `DJANGO_SECRET_KEY` | Random secret of at least 50 characters, stored as a Vercel Secret |
| `DATABASE_URL` | Dedicated PostgreSQL URL with `sslmode=require` or stronger |
| `REDIS_URL` | Dedicated `rediss://` TLS connection URL; redis-py needs the Redis protocol URL, not the REST URL/token |
| `DEBUG` | `0` |
| `COOKIE_SECURE` | `1` |
| `ALLOWED_HOSTS` | Explicit demo hostname; Vercel adds the current deployment and production host automatically |
| `REDIS_SOCKET_TIMEOUT` | `1` second for hosted Redis; local default remains 0.3 seconds |
| `RATE_LATEST_TTL` | Default 3600 seconds |
| `RATE_HISTORY_TTL` | Default 604800 seconds |
| `CALC_TTL` | Default 900 seconds |

Never paste database/Redis credentials into the README, a screenshot, source code, a shell command argument, or a chat. Feed secret values to `vercel env add` through stdin. Do not commit pulled `.env.local` or `.vercel/` files. Integration-provisioned credentials must target only the intended environment.

## Deploy

1. Confirm the signed-in Vercel account with `vercel whoami` and select your actual team.
2. Link explicitly: `vercel link --yes --scope YOUR_TEAM --project quoteguard`.
3. Verify the resolved owner and project with `vercel project inspect --non-interactive`.
4. Create the free resources, accept required provider terms yourself, and add production environment variables.
5. Run local regressions and the locked dependency audits. Use the dedicated infrastructure described in `testing.md`; never benchmark the hosted/public provider repeatedly.
6. Run `vercel deploy --prod`. The Django build applies migrations and runs the idempotent synthetic seed; a failed migration must fail the build.
7. Wait for Ready, then test the actual public alias without your Vercel login: page/assets, health, login/CSRF, owner isolation, calculate/cache, stale-edit recalculation, scenarios, finalisation, PDF/CSV and revision. Verify mobile layout, keyboard and accessibility.
8. Record exact deployment ID/URL, source commit, test results, provider dates and limitations in `deployment-verification.md`. A Ready deployment alone is insufficient.

Preview credentials are intentionally not copied from production. Provision separate preview resources before preview deployments. No public management/seed/benchmark endpoint is introduced; the recorded-provider server refuses non-local infrastructure.

## Presentation preflight

Open `/api/health/` on the verified demo domain and confirm database, Redis and application are all `ok`. Sign in, calculate the rehearsal quote once to wake free services, and open Cache Lab. Keep the local Docker/recorded-provider fallback ready on a second tab. Cached rates still show their observation dates and expire normally; warming is not a promise that the rate will never change.

If a real reference request fails, explain the error, wait briefly and retry once. Do not invent a rate, repeatedly click refresh, or describe recorded evidence as live. If the classroom internet fails, use the explicitly labelled recorded local demo and show the original source/hash and real Redis behavior. See `demo-script.md`.

## Recovery

Keep the last verified production deployment available for rollback through the Vercel dashboard. Database migrations and records persist independently of deployment rollback; inspect compatibility first. Keep PostgreSQL backups according to the provider's available free features. Redis can be rebuilt; frozen snapshots must remain in PostgreSQL. Never run `down -v`, delete resources, or flush another project's Redis while troubleshooting.
