# Production Deployment Guide — Frontend

This guide describes how to deploy the Next.js frontend in `Dechat/dex_with_fiat_frontend` to a
production environment. It is based on the checked-in configuration and source code; no
deployment, build, or test command was executed while writing it.

The frontend is a Next.js 15 application with API routes (including the Paystack webhook), so it
requires a Node.js server runtime. There is no `output: 'export'` configuration in
[`next.config.ts`](../Dechat/dex_with_fiat_frontend/next.config.ts); a static-only host is not a
drop-in deployment target.

## 1. Development versus production configuration

| Concern | Development (in this repository) | Production requirement |
|---------|-----------------------------------|------------------------|
| Image | [`Dockerfile.dev`](../Dechat/dex_with_fiat_frontend/Dockerfile.dev) only | No production Dockerfile exists; one must be provided by the deployment setup |
| Command | `pnpm dev` (`next dev --turbopack`); Compose overrides with `npm run dev` | `pnpm build` (`next build`) followed by `pnpm start` (`next start`) |
| Volumes | Compose bind-mounts the source tree plus anonymous `/app/node_modules` and `/app/.next` | Do not mount source or build caches into the runtime container |
| Node environment | `NODE_ENV=development` in [`docker-compose.yml`](../docker-compose.yml) and [`.env.docker`](../.env.docker) | Set `NODE_ENV=production` via the platform |
| Dependencies | `pnpm install --frozen-lockfile` including dev dependencies | Build with the lockfile; the runtime only needs what `next start` requires |
| Stellar services | `stellar/quickstart` local network at `http://soroban-local-net:8000` | Use the intended production RPC/Horizon endpoints; `allowHttp: false` is hard-coded in `stellarContract.ts` |
| Health check | Only the `soroban-local-net` Compose service has a healthcheck | Point your platform's probe at `GET /api/health` |

The repository's only Dockerfile is `Dockerfile.dev`. It is a single-stage `node:20-alpine`
image that copies the source and runs the dev server; it is **not suitable for production**
(development compilation, source bind mounts, and no production health check). Do not deploy it
as-is. If you use containers, provide a production image that performs `next build` and starts
the server with `next start`, without the Compose dev volumes.

Grounded production sequence (from the frontend `package.json` scripts and CI):

```bash
cd Dechat/dex_with_fiat_frontend
pnpm install --frozen-lockfile
# Provide all required environment variables BEFORE the build (NEXT_PUBLIC_* are inlined)
pnpm build
pnpm start
```

CI uses pnpm `9.15.9` and Node `24` in [`.github/workflows/frontend.yml`](../.github/workflows/frontend.yml);
the repository root [`.nvmrc`](../.nvmrc) is `20`, and the Docker image uses Node 20. There is no
single authoritative Node version across all files, so pin the version used by your deployment
platform explicitly.

### Option A: Vercel

There is no `vercel.json`, `.vercelignore`, or frontend deployment workflow in this repository, so
configure the project on the platform rather than expecting checked-in deployment files:

- Set the project root to `Dechat/dex_with_fiat_frontend` and use the pnpm build command
  `pnpm build` with output from `next start` (the standard Next.js runtime).
- Add the environment variables from section 2 in the Vercel project settings for the correct
  environment (Production vs Preview). `NEXT_PUBLIC_*` values are inlined at build time, so set
  them before the deployment is built.
- Set `NODE_ENV=production` (Vercel does this for production deployments) and do **not** set
  `NEXT_PUBLIC_E2E` in production.
- Sentry release/source-map upload is configured in `next.config.ts` via `withSentryConfig` using
  `SENTRY_ORG` and `SENTRY_PROJECT`; no `SENTRY_AUTH_TOKEN` is referenced anywhere in this
  repository, so source-map upload will need platform authentication to be arranged separately.
  The exact mechanism cannot be determined from source inspection.

### Option B: Production container

Because no production Dockerfile is checked in, treat the following as requirements rather than
ready-made repository files:

- Build in a stage that has the pnpm toolchain, install with `pnpm install --frozen-lockfile`,
  inject build-time public variables, and run `pnpm build`.
- Use a runtime stage with only production dependencies and the `.next` output, run as a
  non-root user, expose the port that `next start` listens on (3000 by default in local
  development), and set `NODE_ENV=production`.
- Pass server-only secrets at runtime; never bake them into an image layer.
- Configure a container health check against `GET /api/health`, and keep the container's logs
  available to your log collector.
- Deploy the image with an immutable tag (for example, a commit SHA), so a previous tag can be
  redeployed during rollback. No image name, registry, or release workflow exists in the
  repository today.

## 2. Environment variables and secrets

The authoritative schemas are
[`clientEnv.ts`](../Dechat/dex_with_fiat_frontend/src/lib/clientEnv.ts) (public) and
[`serverEnv.ts`](../Dechat/dex_with_fiat_frontend/src/lib/serverEnv.ts) (server-only, importing
`server-only`). The documented list is in
[`.env.example`](../Dechat/dex_with_fiat_frontend/.env.example). Never put credentials in source
control; `.env` and `.env.*` are ignored except `.env.example`.

### Public variables (`NEXT_PUBLIC_*`, safe for the browser)

These are intentionally exposed. Do not place secrets in them.

| Variable | Purpose | Required / default | Safe in browser |
|----------|---------|--------------------|-----------------|
| `NEXT_PUBLIC_STELLAR_RPC_URL` | Soroban RPC endpoint | Default `https://soroban-testnet.stellar.org`; set to the production RPC before building | Yes; URL only. Must be allowed by the CSP `connect-src` when custom |
| `NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT` | Deployed `FiatBridge` contract address | Defaults to a testnet address; set for production | Yes; public contract ID |
| `NEXT_PUBLIC_XLM_SAC_CONTRACT` | Native XLM Stellar Asset Contract address | Defaults to a testnet address; set for production | Yes; public contract ID |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | Horizon endpoint for historical/fallback queries | Optional; derived from the RPC URL when absent | Yes; URL only, also covered by CSP |
| `NEXT_PUBLIC_SENTRY_DSN` | Browser Sentry DSN | Optional | Yes by design; passed to `Sentry.init` in the browser |
| `NEXT_PUBLIC_FLAG_CONVERSION_REMINDERS` | Enables conversion reminders | Optional; enabled unless exactly `"false"` | Yes |
| `NEXT_PUBLIC_FLAG_ADMIN_RECONCILIATION` | Enables the admin reconciliation UI | Optional; enabled unless exactly `"false"` | Yes; authorization is enforced server-side/on-chain |
| `NEXT_PUBLIC_FLAG_ENABLE_HAPTICS` | Enables haptics | Optional; enabled unless exactly `"false"` | Yes |

`NEXT_PUBLIC_E2E` is a public behavior flag used by the test harness; Playwright sets it to
`"true"`. Do not enable it in production. The exact flag names are read in
[`featureFlags.ts`](../Dechat/dex_with_fiat_frontend/src/lib/featureFlags.ts).

`NEXT_PUBLIC_GEMINI_API_KEY` appears in `.env.example` and a build workflow, but no application
code reads it; use the server-side `GEMINI_API_KEY` instead.

### Server-only variables (never expose to the browser)

| Variable | Purpose | Required / default | Exposure |
|----------|---------|--------------------|----------|
| `PAYSTACK_SECRET_KEY` | Paystack Bearer token for payout APIs **and** HMAC key for webhook verification | Optional in schema; required for real Paystack operations and webhooks | **Secret.** Read through `serverEnv.ts`; missing value makes the webhook fail closed with 400 |
| `PAYOUT_PROVIDER` | Payout provider selector | Default `paystack`; only `paystack` is registered | Server-only; no browser need |
| `ADMIN_SECRET` | Token for admin reconciliation/audit endpoints | Optional | **Secret.** Sent as `x-admin-token` or `Authorization: Bearer ...` |
| `ADMIN_IP_ALLOWLIST` | Comma-separated admin IP allowlist | Optional; allowlist off when empty | Server-only |
| `ADMIN_IP_ALLOWLIST_BYPASS_LOCAL` | Bypass allowlist for loopback outside production | Default `false`; `"true"` or `"1"` accepted; ignored when `NODE_ENV=production` | Server-only |
| `TRUSTED_PROXY_HOPS` | Number of trusted `X-Forwarded-For` hops | Default `0` | Server-only; affects IP-based checks |
| `GEMINI_API_KEY` | Server-side Gemini key for `/api/ai/chat` | Optional; AI endpoint degrades gracefully when absent | **Secret.** Never leaves the server |
| `SENTRY_ORG` | Sentry organization for build-time release/source-map upload | Optional | Build-time setting; not a secret, no browser need |
| `SENTRY_PROJECT` | Sentry project for build-time release/source-map upload | Optional | Build-time setting; not a secret |

`ADMIN_API_TOKEN` is mentioned in `.env.example` but is not read by application code;
`ADMIN_SECRET` is the implemented variable. `NODE_ENV` and `CI` are platform-provided and not
secrets. Older workflow files still reference `NEXT_PUBLIC_STELLAR_CONTRACT_ID`,
`NEXT_PUBLIC_XLM_SAC_ID`, and `NEXT_PUBLIC_STELLAR_NETWORK`; these are obsolete (see
[`docker-validate.yml`](../.github/workflows/docker-validate.yml)) and are not read by `src/`.

### Sentry configuration

Browser error tracking is initialized in
[`instrumentation-client.ts`](../Dechat/dex_with_fiat_frontend/src/instrumentation-client.ts)
with `NEXT_PUBLIC_SENTRY_DSN`, `environment: process.env.NODE_ENV`, `tracesSampleRate: 1.0`, and
10% session replay sampling with `maskAllText` and `blockAllMedia`. The Sentry tunnel route is
`/monitoring` (configured through `withSentryConfig`); it is not a health endpoint. Server and
edge Sentry config files are referenced only in commented-out code in
[`instrumentation.ts`](../Dechat/dex_with_fiat_frontend/src/instrumentation.ts) and do not exist.

### Paystack configuration

`PAYSTACK_SECRET_KEY` is the only payment secret. It authenticates calls to Paystack in
[`paystackProvider.ts`](../Dechat/dex_with_fiat_frontend/src/lib/payout/providers/paystackProvider.ts)
and the `/api/banks` and `/api/create-recipient` routes, and verifies webhook signatures in
`/api/webhook`. `PAYOUT_PROVIDER` selects the provider registry entry. When the secret is absent,
payout helpers return mock results, but the webhook rejects all requests with 400; configure it
for production.

## 3. Paystack webhook registration

### Identify the production URL

The webhook handler is the Next.js route
[`src/app/api/webhook/route.ts`](../Dechat/dex_with_fiat_frontend/src/app/api/webhook/route.ts),
which exports only `POST`. Its path is therefore:

```
https://<your-production-origin>/api/webhook
```

Use the actual deployment origin (custom domain or platform-assigned domain). The repository does
not contain a configured production hostname or a `vercel.json`, so the concrete URL must come
from your deployment platform. There is no `/api/paystack/webhook` route.

### Register and configure

1. Deploy the frontend with `PAYSTACK_SECRET_KEY` set in the **production** environment of the
   frontend host. Use the same secret that Paystack uses to sign events. There is no separate
   webhook-secret variable in this codebase.
2. In the Paystack dashboard, register the URL above for the production Paystack account and
   enable the events this handler supports:
   `transfer.success`, `transfer.failed`, and `transfer.reversed`.
3. Keep live and test keys, webhook URLs, and environments separate. Never place the secret in a
   `NEXT_PUBLIC_*` variable, a client bundle, or an image layer.
4. After changing the secret or URL, redeploy/restart the frontend so the runtime reads the new
   value; `serverEnv.ts` parses the value at module load.

The repository contains no dashboard walkthrough or webhook registration script, so the exact
dashboard labels cannot be confirmed from source inspection.

### How requests are handled

- The handler reads the raw request body and the `x-paystack-signature` header.
- It computes `HMAC-SHA512(PAYSTACK_SECRET_KEY, raw_body)` as hex and compares it to the header.
- Missing header returns `401 {"message":"No signature provided"}`; a mismatch returns
  `401 {"message":"Invalid signature"}`; absent secret returns
  `400 {"message":"Webhook processing is not configured"}`.
- After verification it parses JSON and requires `event.data.id` or `event.data.reference`.
  Supported events update transfer status and publish a browser notification through the
  in-memory payment status event bus. Unknown events are logged but still receive 200.
- Success returns `200 {"received":true}`. Parsing errors return 400; unexpected errors return
  500 with `Webhook processing error:` in the logs.

Operational caveats visible in source: transfer records, replay keys, and event listeners are
stored in memory (`transferStore.ts`, `paymentStatusEvents.ts`) and reset on restart; a webhook
delivered to a different instance than the browser's connection will not produce a live
notification. The replay key is recorded but the current code does not block duplicate
processing, and the signature comparison is a plain string comparison. Consider these limits
when choosing instance counts and when designing retry/idempotency procedures outside this app.

### Troubleshooting delivery failures

| Symptom | Likely cause / check |
|---------|----------------------|
| 400 `Webhook processing is not configured` | `PAYSTACK_SECRET_KEY` is missing in the runtime environment |
| 401 `Invalid signature` | Wrong secret, or Paystack signed a different/re-serialized body; the handler signs the **raw** body |
| 401 `No signature provided` | Header missing; confirm the dashboard webhook configuration |
| 400 `Webhook payload must be valid JSON` / `Event data must contain id or reference` | Unexpected payload shape; inspect the logged event |
| 500 `Webhook processing failed` | Check `Webhook processing error:` and telemetry JSON logs |
| 200 but no browser notification | In-memory listener/store limitation; check `/api/payment-status/stream` and which instance served the request |

Logs can be filtered by the console messages `Received Paystack webhook:`, `Invalid webhook
signature`, and `PAYSTACK_SECRET_KEY is not configured. Rejecting webhook.` Telemetry writes JSON
lines via `console.log` in [`telemetry.ts`](../Dechat/dex_with_fiat_frontend/src/lib/telemetry.ts).

## 4. Health checks

### Existing endpoint

`GET /api/health` is implemented in
[`src/app/api/health/route.ts`](../Dechat/dex_with_fiat_frontend/src/app/api/health/route.ts)
with `runtime = 'edge'`. On success it returns HTTP 200:

```json
{ "status": "ok", "timestamp": "2026-01-01T00:00:00.000Z" }
```

The catch branch returns HTTP 503 with `status: "error"` and a message. The handler only proves
that the edge function can respond; it does **not** verify Paystack, Stellar RPC, Horizon, Sentry,
or environment validity. The in-app status badge (`API Healthy` / `API Degraded`) polls this
endpoint every 60 seconds from `StellarChatInterface.tsx`.

There are no other application health endpoints, no `HEALTHCHECK` directive in `Dockerfile.dev`,
and no frontend healthcheck in `docker-compose.yml` (only the local Soroban service has one).
`/monitoring` is a Sentry tunnel, not a health check.

### When startup fails

- Check the platform deployment/build logs first. `next build` failures are usually environment
  or type/build issues; `next start` failures are usually port or runtime configuration issues.
- Look for `❌ Invalid client environment variables` or `❌ Invalid server environment variables`
  from `clientEnv.ts` / `serverEnv.ts` — these indicate malformed or missing values (for example,
  a non-URL RPC value).
- Request `GET /api/health` on the deployed origin. A 503 or a non-response means the server is
  not serving; a 200 with a degraded in-app badge points to a client-side or downstream issue.
- For payment issues, inspect the webhook log messages in section 3. For transaction errors, check
  `Initiate transfer error:` and Sentry events tagged with `endpoint: '/api/initiate-transfer'`.
- In the local Compose setup, the frontend waits for the `soroban-local-net` healthcheck (`curl
  -f http://localhost:8000/`); if that service is unhealthy, the frontend does not start.

## 5. Rollback procedures

The repository contains no frontend deployment automation, release tags, or rollback script, so
exact dashboard/CLI steps depend on the host chosen. Record the deployed commit SHA and the
environment configuration with every release; without that record there is nothing reliable to
roll back to.

### Vercel

- In the Vercel dashboard, open the project's **Deployments** list, find the last known-good
  deployment (identify it by its linked commit SHA), and use the platform's **Promote to
  Production** action for that deployment. This swaps traffic back without rebuilding.
- If the CLI is used instead, the equivalent is `vercel promote <deployment-url-or-id>`; this
  command is not configured or documented in this repository, so verify it against your
  Vercel account before relying on it.
- If the bad release also changed environment variables, restore the previous values in the
  Production environment and redeploy. Because `NEXT_PUBLIC_*` values are inlined at build time,
  changing them requires a fresh build, not just a runtime restart.

### Production container

- Redeploy the previous immutable image tag (the one recorded for the last known-good commit).
  Do not reuse a mutable `latest` tag for this.
- Restore the previous runtime environment/secrets at the same time if the release changed them.
- No image registry or tag convention exists in the repository; the tag scheme must come from
  your own build pipeline.

### Environment-variable mistakes

- Compare current values against `Dechat/dex_with_fiat_frontend/.env.example` and the schemas in
  `clientEnv.ts` / `serverEnv.ts`. Remove obsolete names listed in section 2.
- Rotate any secret that may have been exposed, update it in the platform secret store (and in
  Paystack for the webhook secret if it changed), then redeploy/restart. Never commit a `.env`
  file to "fix" a deployment.
- If a secret was accidentally exposed in a `NEXT_PUBLIC_*` value, treat it as compromised even
  after correcting the variable.

### Verify the previous version is serving traffic

- Request `GET /api/health` on the production origin and confirm HTTP 200.
- Confirm the deployed commit SHA shown by the platform (or by your image tag) matches the
  intended previous release.
- Load `/` and `/chat` and check the in-app API status badge and wallet connection flow.
- Re-send a test transfer event (test environment first) to `/api/webhook` through Paystack's
  resend mechanism and confirm a 200 and the expected status change.
- Check Sentry for a drop in new errors after the rollback.

## 6. Security and operational guidance

- **Secrets management:** keep `PAYSTACK_SECRET_KEY`, `ADMIN_SECRET`, and `GEMINI_API_KEY` in the
  platform's secret store, never in the browser or image. Follow the repository guidance in
  [`SECURITY.md`](../SECURITY.md): use environment variables for configuration, least privilege,
  and no private keys in code.
- **HTTPS:** terminate TLS at the platform. The application already emits
  `Strict-Transport-Security`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, and a
  CSP in `next.config.ts`. If a custom RPC/Horizon URL is used, add its origin to `connect-src` or
  the CSP will block browser requests. `stellarContract.ts` uses `allowHttp: false`, so plain
  HTTP RPC endpoints will not work.
- **Environment separation:** use separate Stellar accounts/contracts, Paystack keys, and webhook
  URLs for development, preview, and production. Keep `NEXT_PUBLIC_E2E` and
  `ADMIN_IP_ALLOWLIST_BYPASS_LOCAL` out of production. Some admin state (sessions, rate limits,
  transfer records) is in-memory, so multi-instance deployments do not share it.
- **Logging and monitoring:** collect structured console/telemetry logs and platform logs. The
  UI already surfaces `API Healthy` / `API Degraded`; wire `/api/health` into platform uptime
  checks and alerts. No log aggregation or alerting is configured in the repository.
- **Sentry error tracking:** set `NEXT_PUBLIC_SENTRY_DSN` for client errors and `SENTRY_ORG` /
  `SENTRY_PROJECT` for build-time release metadata. Browser replay masks text and media. A
  separate Sentry auth token is not present in the repository; source-map upload must be
  configured on the platform if required.
- **Webhook security:** keep the raw-body HMAC check intact, use the same production secret on
  both sides, restrict inbound traffic where the platform allows it, and monitor 401 spikes as a
  possible signing or configuration problem. Be aware of the in-memory idempotency limitations
  described in section 3.
