# Contributing

This document covers everything you need to open your first pull request.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Setup](#local-setup)
3. [Branch Naming](#branch-naming)
4. [Commit Message Format](#commit-message-format)
5. [Running Tests](#running-tests)
6. [Submitting a PR](#submitting-a-pr)
7. [Code Style](#code-style)

---

## Prerequisites

Install the following tools before you begin.

| Tool | Minimum version | Notes |
|---|---|---|
| Node.js | 20.x | Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to manage versions |
| Rust toolchain | stable | Install via [rustup](https://rustup.rs/) |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | latest | Install via `cargo install --locked stellar-cli` |
| Freighter extension | latest | Browser wallet available at the [Freighter website](https://www.freighter.app/) |

Verify your setup:

```bash
node --version        # v20.x.x
rustup show           # active toolchain: stable
stellar --version
```

---

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/xqcxx/Stellar-Dex-Chat.git
cd Stellar-Dex-Chat
```

### 2. Configure environment variables

The frontend requires a `.env.local` file. Copy the example and fill in the values:

```bash
cp dex_with_fiat_frontend/.env.example dex_with_fiat_frontend/.env.local
```

The required variables are:

```
NEXT_PUBLIC_STELLAR_CONTRACT_ID=   # deployed Soroban contract ID
NEXT_PUBLIC_XLM_SAC_ID=            # XLM Stellar Asset Contract ID
NEXT_PUBLIC_STELLAR_RPC_URL=       # e.g. https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_NETWORK=       # TESTNET or PUBLIC
GEMINI_API_KEY=                    # Google Gemini API key for the AI assistant
PAYSTACK_SECRET_KEY=               # Paystack secret key for fiat payouts
PAYOUT_PROVIDER=                   # e.g. paystack
```

> For local development against testnet you can leave `NEXT_PUBLIC_STELLAR_RPC_URL` pointing at `https://soroban-testnet.stellar.org` and set `NEXT_PUBLIC_STELLAR_NETWORK=TESTNET`.

### 3. Install frontend dependencies

```bash
cd dex_with_fiat_frontend
npm ci
```

### 4. Run the development server

```bash
npm run dev
```

The app is available at `http://localhost:3000`.

### 5. Build and test the Soroban contract

From the repository root:

```bash
cd stellar-contracts
cargo build --target wasm32-unknown-unknown --release
cargo test
```

If you use VS Code, the repository includes workspace settings that point Rust Analyzer at [stellar-contracts/Cargo.toml](./stellar-contracts/Cargo.toml). Install the recommended `rust-lang.rust-analyzer` extension when prompted so contract code navigation and diagnostics work out of the box.

---

## Branch Naming

Use one of the following prefixes followed by a short, hyphen-separated description:

| Prefix | When to use |
|---|---|
| `feature/` | New functionality |
| `fix/` | Bug fixes |
| `docs/` | Documentation-only changes |

Examples:

```
feature/add-swap-confirmation-modal
fix/wallet-disconnect-on-reload
docs/update-local-setup-steps
```

---

## Commit Message Format

This project follows [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>(<optional scope>): <short description>

[optional body]

[optional footer — e.g. Closes #42]
```

Allowed types:

| Type | When to use |
|---|---|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes only |
| `test` | Adding or updating tests |
| `chore` | Tooling, dependency updates, CI changes |

Examples:

```
feat(swap): add slippage tolerance input
fix(wallet): clear session on Freighter disconnect
docs: add Stellar CLI to prerequisites
test(contract): add coverage for daily limit reset
chore: upgrade soroban-sdk to 25.3.0
```

---

## Running Tests

### Contract tests

Run from the `stellar-contracts` directory:

```bash
cd stellar-contracts
cargo test
```

All snapshot files under `test_snapshots/` are committed to the repository. If your changes alter contract behaviour, update the snapshots by running:

```bash
cargo test -- --update-snapshots
```

and commit the updated files alongside your code changes.

### Frontend build check

Run from the `dex_with_fiat_frontend` directory:

```bash
npm run build
```

A successful build confirms there are no TypeScript compilation errors.

### Frontend lint

```bash
npm run lint
```

### End-to-end tests

Playwright e2e tests require a running dev server:

```bash
# Install browsers once
npm run test:e2e:install

# Run all e2e tests
npm run test:e2e
```

---

## Submitting a PR

Before opening a pull request, confirm the following checklist:

- [ ] The PR description references the related issue: `Closes #ISSUE_NUMBER`
- [ ] `cargo test` passes with no failures
- [ ] `npm run build` completes without errors
- [ ] `npm run lint` reports no new lint errors
- [ ] Screenshots or screen recordings are included for any UI changes
- [ ] Snapshot files are updated if contract behaviour changed
- [ ] No secrets or `.env.local` values are committed

Open the PR against the `main` branch.

---

## Code Style

### Rust

Format all Rust code with `rustfmt` before committing:

```bash
cd stellar-contracts
cargo fmt
```

CI will not enforce formatting automatically, but reviewers will request changes if the diff includes unformatted code.

### TypeScript

The frontend uses the ESLint configuration defined in `dex_with_fiat_frontend/eslint.config.mjs`, which extends `next/core-web-vitals` and `next/typescript`. Run the linter before pushing:

```bash
cd dex_with_fiat_frontend
npm run lint
```

Code formatting is handled by Prettier. To auto-fix formatting in the `src/` directory:

```bash
npm run format
```

To check without modifying files:

```bash
npm run check
```
