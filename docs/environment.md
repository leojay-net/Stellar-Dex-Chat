# Environment Variable Reference

This document provides a centralized reference for all environment variables used across the Stellar-Dex-Chat application, including the Next.js frontend, Soroban smart contract interactions, payment gateways, and CI/CD automation pipelines.

---

## Table of Contents

- [Overview & Security Principles](#overview--security-principles)
- [Comprehensive Environment Variable Reference](#comprehensive-environment-variable-reference)
  - [Client-Side Variables (`NEXT_PUBLIC_*`)](#client-side-variables-next_public_)
  - [Server-Side Variables](#server-side-variables)
  - [CI/CD & Pipeline Variables](#cicd--pipeline-variables)
  - [Docker & Container Environment Variables](#docker--container-environment-variables)
- [Configuring Local Development](#configuring-local-development)
  - [Frontend Local Setup (`.env.local`)](#frontend-local-setup-envlocal)
  - [Quick Copy Commands](#quick-copy-commands)
- [Configuring Docker Environment](#configuring-docker-environment)
- [Validation & CI Integrity](#validation--ci-integrity)

---

## Overview & Security Principles

The frontend application uses [Zod](https://zod.dev) schemas defined in `Dechat/dex_with_fiat_frontend/src/lib/clientEnv.ts` and `Dechat/dex_with_fiat_frontend/src/lib/serverEnv.ts` to strictly validate environment variables at startup and runtime.

### Public vs. Private Variables

1. **Client-Side Variables (`NEXT_PUBLIC_*`)**:
   - Bundled into browser JavaScript by Next.js during build/compilation time.
   - **Never store sensitive secrets, private keys, API credentials, or database secrets in `NEXT_PUBLIC_*` variables.**
   - Safe for public contract addresses, public RPC URLs, non-sensitive feature flags, and public tracking identifiers.

2. **Server-Side Variables (No `NEXT_PUBLIC_` prefix)**:
   - Protected by `import 'server-only'` in `src/lib/serverEnv.ts`.
   - Accessible only in Next.js Server Components, Server Actions, Route Handlers (`/api/*`), and `getServerSideProps`.
   - Never sent to the client browser or included in frontend assets.

---

## Comprehensive Environment Variable Reference

### Client-Side Variables (`NEXT_PUBLIC_*`)

These variables are validated by `clientSchema` in `src/lib/clientEnv.ts` or read directly by client components and utility modules.

| Variable Name | Scope | Required | Default Value | Example Value | Secret? | Description |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT` | Client | Optional (Defaulted) | `CAWYXBN4PSVXD7NIYEWVFFIIIEUCC6PUN3IMG3J2WHKDB4NVIISMXBPR` | `CAWYXBN4PSVXD7NIYEWVFFIIIEUCC6PUN3IMG3J2WHKDB4NVIISMXBPR` | No | Deployed Soroban FiatBridge contract address on Stellar (starts with `C`). |
| `NEXT_PUBLIC_XLM_SAC_CONTRACT` | Client | Optional (Defaulted) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | No | Native XLM Stellar Asset Contract (SAC) address on the target network. |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | Client | Optional (Defaulted) | `https://soroban-testnet.stellar.org` | `https://soroban-testnet.stellar.org` | No | Stellar Soroban RPC endpoint used by the SDK to simulate, query, and submit contract transactions. |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | Client | Optional | _None (inferred from RPC)_ | `https://horizon-testnet.stellar.org` | No | Stellar Horizon API URL for historical transactions, account balances, and fee stats. |
| `NEXT_PUBLIC_SENTRY_DSN` | Client | Optional | _None_ | `https://examplePublicKey@o0.ingest.sentry.io/0` | No | Sentry Data Source Name (DSN) for client-side crash reporting, performance monitoring, and session replay. |
| `NEXT_PUBLIC_GEMINI_API_KEY` | Client | Optional | _None_ | `AIzaSyD-placeholder-gemini-key` | Yes (Public Client Token) | Public Google Gemini API key used as a client-side fallback if server-side proxy `/api/ai/chat` is not used. |
| `NEXT_PUBLIC_FLAG_*` | Client | Optional | _None_ | `NEXT_PUBLIC_FLAG_NEW_UI=true` | No | Dynamic runtime feature flag toggles parsed by `src/lib/featureFlags.ts`. |

---

### Server-Side Variables

These variables are validated by `serverSchema` in `src/lib/serverEnv.ts` or consumed by server-side API routes (`/api/*`).

| Variable Name | Scope | Required | Default Value | Example Value | Secret? | Description |
|---|---|---|---|---|---|---|
| `PAYSTACK_SECRET_KEY` | Server | Required for Payouts | _None_ | `sk_test_placeholder_key_abc123` | **Yes** | Secret authorization key for Paystack API to initiate bank transfers, verify accounts, and authenticate webhooks. |
| `PAYOUT_PROVIDER` | Server | Optional (Defaulted) | `paystack` | `paystack` | No | Name of the active payout provider registered in `src/lib/payout/providers/registry.ts`. |
| `GEMINI_API_KEY` | Server | Optional | _None_ | `AIzaSyD-placeholder-gemini-key` | **Yes** | Google Gemini API key used by the `/api/ai/chat` endpoint to process natural language chat messages without exposing keys to the browser. |
| `ADMIN_API_TOKEN` | Server | Optional | _None_ | `adm_sec_tok_example999` | **Yes** | Bearer authentication token used to authenticate privileged admin API routes. |
| `ADMIN_SECRET` | Server | Optional | _None_ | `super_secret_admin_token_xyz` | **Yes** | Secret token required for administrative ledger reconciliation and audit log export endpoints. |
| `ADMIN_IP_ALLOWLIST` | Server | Optional | _None_ | `203.0.113.10,198.51.100.20` | Sensitive | Comma-separated list of IPv4 and IPv6 client IP addresses authorized to access `/admin` and `/api/admin/*`. |
| `ADMIN_IP_ALLOWLIST_BYPASS_LOCAL` | Server | Optional (Defaulted) | `false` | `true` | No | When set to `true` or `1`, bypasses the admin IP allowlist for localhost/loopback requests in `NODE_ENV=development`. Ignored in production. |
| `TRUSTED_PROXY_HOPS` | Server | Optional (Defaulted) | `0` | `1` | No | Number of trusted reverse proxy hops to skip from the right side of the `X-Forwarded-For` header when determining client IP. |
| `SENTRY_ORG` | Server / Build | Optional | _None_ | `my-organization` | No | Sentry organization identifier for uploading source maps during production builds. |
| `SENTRY_PROJECT` | Server / Build | Optional | _None_ | `stellar-dex-chat` | No | Sentry project identifier for uploading source maps during production builds. |

---

### CI/CD & Pipeline Variables

The continuous integration pipelines (`.github/workflows/frontend.yml`, `.github/workflows/frontend-build.yml`) utilize specific environment variables and secret bindings to ensure reproducible builds and end-to-end testing:

| Variable Name | Scope | Required | Default in CI | Example Value | Secret? | Description |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_STELLAR_CONTRACT_ID` | CI / Client | Optional (CI Fallback) | `PLACEHOLDER` | `CAWYXBN4PSVXD7NIYEWVFFIIIEUCC6PUN3IMG3J2WHKDB4NVIISMXBPR` | No | Legacy CI alias for the FiatBridge contract address. Forwarded to build and E2E jobs. |
| `NEXT_PUBLIC_XLM_SAC_ID` | CI / Client | Optional (CI Fallback) | `PLACEHOLDER` | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | No | Legacy CI alias for the native XLM Stellar Asset Contract address. Forwarded to build and E2E jobs. |
| `NEXT_PUBLIC_STELLAR_NETWORK` | CI / Client | Optional (Defaulted) | `TESTNET` | `TESTNET` | No | Specifies the target network for CI builds and integration tests (`TESTNET` or `PUBLIC`). |

> [!NOTE]
> In application source code (`clientEnv.ts`), canonical contract references use `NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT` and `NEXT_PUBLIC_XLM_SAC_CONTRACT`. CI workflows provide `NEXT_PUBLIC_STELLAR_CONTRACT_ID` and `NEXT_PUBLIC_XLM_SAC_ID` for backward compatibility with automated test harnesses.

---

### Docker & Container Environment Variables

Defined in `.env.docker` and utilized by `docker-compose.yml`:

| Variable Name | Scope | Default in Docker | Example Value | Description |
|---|---|---|---|---|
| `NEXT_PUBLIC_STELLAR_RPC_URL` | Client / Container | `http://localhost:8000/rpc` | `http://localhost:8000/rpc` | Points to the local Soroban Quickstart container RPC endpoint. |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | Client / Container | `http://localhost:8000` | `http://localhost:8000` | Points to the local Soroban Quickstart container Horizon endpoint. |
| `NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT` | Client / Container | _Empty (populate after local deploy)_ | `CAWYXBN4PSVXD7NIYEWVFFIIIEUCC6PUN3IMG3J2WHKDB4NVIISMXBPR` | Deployed contract ID on the local standalone network. |
| `NEXT_PUBLIC_XLM_SAC_CONTRACT` | Client / Container | _Empty (populate after local deploy)_ | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | SAC ID on the local standalone network. |
| `PAYOUT_PROVIDER` | Server / Container | `paystack` | `paystack` | Payout provider mode. |
| `PAYSTACK_SECRET_KEY` | Server / Container | `sk_test_placeholder` | `sk_test_placeholder` | Mock or test secret key for containerized execution. |
| `GEMINI_API_KEY` | Server / Container | `PLACEHOLDER` | `PLACEHOLDER` | Optional placeholder for AI features in local containers. |
| `NODE_ENV` | Runtime / Container | `development` | `development` | Node execution environment. |
| `NEXT_TELEMETRY_DISABLED` | Runtime / Container | `1` | `1` | Disables Next.js anonymous telemetry inside containers. |

---

## Configuring Local Development

### Frontend Local Setup (`.env.local`)

Next.js automatically loads `.env.local` files in the frontend directory (`Dechat/dex_with_fiat_frontend`).

### Quick Copy Commands

To set up your local development environment from the repository root:

```bash
# 1. Copy the example configuration to .env.local
cp Dechat/dex_with_fiat_frontend/.env.example Dechat/dex_with_fiat_frontend/.env.local

# 2. Edit .env.local and configure your secrets (e.g., Paystack test key)
# nano Dechat/dex_with_fiat_frontend/.env.local
```

Alternatively, if working directly inside the `Dechat/dex_with_fiat_frontend` directory:

```bash
cd Dechat/dex_with_fiat_frontend
cp .env.example .env.local
```

### Minimum Configuration for Local Development

To run the application locally without initiating real bank withdrawals:

```env
# Required for contract interactions (defaults connect to Stellar Testnet)
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT=CAWYXBN4PSVXD7NIYEWVFFIIIEUCC6PUN3IMG3J2WHKDB4NVIISMXBPR
NEXT_PUBLIC_XLM_SAC_CONTRACT=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

# Provider setup
PAYOUT_PROVIDER=paystack
PAYSTACK_SECRET_KEY=sk_test_your_test_key_here

# Optional: AI assistant
GEMINI_API_KEY=your_gemini_api_key_here
```

---

## Configuring Docker Environment

The repository includes a complete local Stellar development environment via Docker Compose (`docker-compose.yml`), which spins up:
- Stellar Quickstart container running standalone Core, Horizon, and Soroban RPC.
- DexFiat Next.js frontend container.

### Step-by-Step Docker Setup

1. Copy the Docker environment template:
   ```bash
   cp .env.docker Dechat/dex_with_fiat_frontend/.env.local
   ```

2. Start the Docker containers:
   ```bash
   docker compose up -d
   ```

3. Verify service health:
   - Frontend: [http://localhost:3000](http://localhost:3000)
   - Soroban RPC: [http://localhost:8000/rpc](http://localhost:8000/rpc)
   - Horizon: [http://localhost:8000](http://localhost:8000)

4. Once contracts are deployed to the local standalone network, update `NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT` and `NEXT_PUBLIC_XLM_SAC_CONTRACT` in `Dechat/dex_with_fiat_frontend/.env.local`.

---

## Validation & CI Integrity

To prevent configuration drift, the continuous integration pipeline validates that:
1. `Dechat/dex_with_fiat_frontend/.env.example` contains all required environment variables declared in `clientSchema` and `serverSchema`.
2. Variable names in documentation, schemas, and example files match without discrepancies.
3. No secrets or production credentials are leaked in repository tracked files.

The validation script can be executed locally via:
```bash
cd Dechat/dex_with_fiat_frontend
pnpm exec tsx scripts/validate-env-example.ts
```
