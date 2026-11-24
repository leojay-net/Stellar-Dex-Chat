# Testing Guide

This is the primary entry point for testing documentation in Stellar-Dex-Chat. It covers the
three stacks in this repository — frontend unit tests (Vitest), frontend end-to-end tests
(Playwright), and Soroban contract tests (Cargo) — and points to the more specialized guides
for individual features.

The commands below are derived from the checked-in package scripts, test configuration, and
CI workflows. They have not been executed as part of writing this guide.

## Repository layout

| Stack | Location | Runner | Configuration |
|-------|----------|--------|---------------|
| Frontend unit | `Dechat/dex_with_fiat_frontend/src` | Vitest | [`vitest.config.ts`](../Dechat/dex_with_fiat_frontend/vitest.config.ts), [`vitest.setup.ts`](../Dechat/dex_with_fiat_frontend/vitest.setup.ts) |
| Frontend E2E | `Dechat/dex_with_fiat_frontend/tests/e2e` | Playwright | [`playwright.config.ts`](../Dechat/dex_with_fiat_frontend/playwright.config.ts) |
| Contract | `Dechat/stellar-contracts/src` | Cargo / Soroban SDK | [`Cargo.toml`](../Dechat/stellar-contracts/Cargo.toml) |

The root [`package.json`](../package.json) has no test scripts. Run frontend tests from
`Dechat/dex_with_fiat_frontend` (or use `pnpm --dir <path> <script>` from the repository root).
The [`Makefile`](../Makefile) provides aggregate targets such as `frontend-test`, `frontend-e2e`,
and `contracts-test`; these run the full suites, not individual files.

## Running tests

### Frontend unit tests (Vitest)

The frontend declares `test:unit` (`vitest run`) and `test:unit:watch` (`vitest`) in
[`package.json`](../Dechat/dex_with_fiat_frontend/package.json). Vitest's `include` pattern is
`src/**/*.{test,spec}.{ts,tsx}`, and the `@` alias resolves to `src`.

```bash
# From the frontend directory: the whole unit suite
pnpm test:unit

# A single test file (path is relative to the frontend directory)
pnpm test:unit src/lib/chatSearch.test.ts

# Equivalent explicit form
pnpm exec vitest run src/components/__tests__/AdminGuard.test.tsx

# Watch mode while developing
pnpm test:unit:watch src/hooks/useTransactionFilters.test.ts
```

`test:coverage` runs Vitest with coverage and single-worker settings; CI shards the suite and
merges blob reports. See [`.github/workflows/frontend.yml`](../.github/workflows/frontend.yml)
for the exact CI flags. Filtering by test name is also available through Vitest's `-t` option
when a narrower slice than a file is needed.

#### Coverage and test selection in CI

Each unit-test shard writes its counts and failed test names to the GitHub Actions job
summary. Coverage is enforced on the merged result and on full local coverage runs.

| Metric | Baseline at `7533c61` | Minimum |
| --- | ---: | ---: |
| Statements | 67.63% | 64% |
| Branches | 55.40% | 52% |
| Functions | 67.41% | 64% |
| Lines | 68.60% | 65% |

The baseline was measured with Node 24 and all four Vitest coverage shards after
reconciling the frontend lockfile. The initial floors leave a few percentage points
for variation in the existing suite. As coverage improves, raise the floors in
[`coverage-thresholds.json`](../Dechat/dex_with_fiat_frontend/coverage-thresholds.json)
using a full run. Add or improve tests when a change falls below a floor. The coverage
comment uses the same values as the gate.

Lint rejects focused and skipped test declarations. Use the runner's CLI filters
for local testing. Use Playwright project filters for browser-specific capabilities.

### Frontend E2E tests (Playwright)

Playwright reads specs from `./tests/e2e` and starts a local Next.js server automatically:
`npx next dev --turbopack` locally, or `npx next start` when `CI` is set (CI builds the app
first). The server is started with `NEXT_PUBLIC_E2E=true`, `baseURL` is `http://localhost:3000`,
and browsers are configured for `chromium`, `firefox`, and `webkit`.

```bash
# From the frontend directory: install browsers once
pnpm test:e2e:install

# The whole E2E suite
pnpm test:e2e

# A single spec file
pnpm test:e2e tests/e2e/message.spec.ts

# One browser project only
pnpm exec playwright test tests/e2e/bank-details-modal.spec.ts --project=chromium

# Interactive debugging helpers
pnpm test:e2e:ui
pnpm test:e2e:debug
```

[`tests/e2e/README.md`](../Dechat/dex_with_fiat_frontend/tests/e2e/README.md) contains additional
notes about the local browser setup and individual suites. Note that its examples use `npm run`;
the current package scripts are invoked with `pnpm` as shown above.

### Stellar contract tests (Cargo)

The contract crate is a single package (`stellar-contracts`) using `soroban-sdk` 28.0.0 with the
`testutils` dev feature. There are no explicit `[[test]]` targets: test modules are declared with
`#[cfg(test)] mod ...;` at the end of [`src/lib.rs`](../Dechat/stellar-contracts/src/lib.rs).
That module list is the source of truth for which tests compile and run.

```bash
# From the repository root: the whole contract suite
cargo test --manifest-path Dechat/stellar-contracts/Cargo.toml

# From Dechat/stellar-contracts: the whole contract suite
cargo test

# A single registered test module
cargo test --manifest-path Dechat/stellar-contracts/Cargo.toml test_view_function_snapshots

# A single test inside a module (exact name from the Rust source)
cargo test --manifest-path Dechat/stellar-contracts/Cargo.toml test::test_event_snapshot_heartbeat -- --exact
```

A file under `src/` is not a test just because it is named `test_*.rs`; it must have a matching
`mod` declaration in `lib.rs`. [`INVARIANT_TESTING.md`](../Dechat/stellar-contracts/docs/INVARIANT_TESTING.md)
documents this requirement and lists invariant suites that are currently not registered. Use
`cargo test <module_name>` to confirm a module is executing (and inspect its output) before
treating a new test module as active.

## E2E harness pages

The Next.js route group
[`src/app/(e2e)`](<../Dechat/dex_with_fiat_frontend/src/app/(e2e)>) contains small, deterministic
pages used by the Playwright suite. The parentheses are a Next.js route group: they organize
files without appearing in the URL. Each `page.tsx` is therefore served from the root, for
example `src/app/(e2e)/test-message/page.tsx` is available at `/test-message`.

**Purpose.** Each harness page mounts one UI component (or one component state) with fixed
fixture data and stable `data-testid` hooks, so a spec can assert behavior without setting up a
full chat session, wallet, or backend. Examples:

- `/test-message` renders `ChatMessages` with five fixed messages (markdown, transaction
  preview, suggested actions, user message, and failed message) for `message.spec.ts`.
- `/test-bank-details` opens `BankDetailsModal` with a fixed `xlmAmount` for
  `bank-details-modal.spec.ts`.
- `/test-network-modal-connected`, `-disconnected`, `-mismatch`, `-dark`, and `-light` mount
  the shared `NetworkModalHarness` component in different states for `network-status-modal.spec.ts`.
- `/test-price-ticker`, `/test-chat-search-panel`, `/test-error-boundary`, and the other
  `test-*` pages each support one corresponding spec in `tests/e2e`.

**Access and suite interaction.** Playwright specs call `page.goto('/test-...')` on the
`baseURL` started by `playwright.config.ts`. The specs inject deterministic state where needed:
for example, `page.addInitScript` seeds `window.__NETWORK_STATE` for the network modal harness,
and query parameters such as `?mode=pending&network=polygon` or `?mode=timeout` select a
component state on the CCIP bridge harness page. `tests/e2e/helpers.ts` also installs a mock
wallet bridge and mocked Stellar RPC/Horizon responses for specs that need a connected wallet.

**Setup requirements.**

- Playwright sets `NEXT_PUBLIC_E2E=true` for its web server. In production builds this flag is
  required for the mock wallet bridge in
  [`StellarWalletContext.tsx`](../Dechat/dex_with_fiat_frontend/src/contexts/StellarWalletContext.tsx);
  in non-production builds the mock bridge is enabled without it.
- There is no `layout.tsx` inside the `(e2e)` group, so the pages inherit the root
  [`app/layout.tsx`](../Dechat/dex_with_fiat_frontend/src/app/layout.tsx) (providers and global
  CSS).
- `(e2e)/not-found.tsx` contains a guard that returns `notFound()` unless `NEXT_PUBLIC_E2E` is
  `"true"`, with a comment indicating test routes should 404 in production. No page or layout
  in the group calls it directly, so from source inspection alone it is not determinable whether
  that component is ever rendered for a given request. Do not rely on it as the only mechanism
  keeping harness routes out of production.

**Relationship to normal routes.** The harness pages are not replacements for the application.
Several suites also exercise real routes directly, including `/` (landing page, wallet connect,
deposit flow), `/chat` (chat history, connected wallet), `/admin`, and `/admin/reconciliation`.
Use a harness page when a spec needs a controlled component state; use the real route when the
behavior under test includes navigation, providers, or full-page integration.

## Fixtures and mocking conventions

### Global Vitest setup

[`vitest.setup.ts`](../Dechat/dex_with_fiat_frontend/vitest.setup.ts) runs for every unit test.
It installs `@testing-library/jest-dom`, neutralizes browser APIs (`matchMedia`, `localStorage`,
`ResizeObserver`, `scrollIntoView`, `scrollTo`), mocks `fetch`, filters React `act()` warnings,
and calls `resetNetworkQueueForTests()` in `afterEach`. Prefer extending this file for setup that
genuinely applies everywhere; keep feature-specific mocks local to the test that needs them.

### `server-only`

Server modules import `server-only`, which throws outside a Next.js server bundle. The global
setup mocks it once:

```ts
// vitest.setup.ts
vi.mock('server-only', () => ({}));
```

A few tests repeat this locally (for example `src/lib/env.test.ts` and
`src/app/api/banks/route.test.ts`). Either form is consistent with the existing code; the global
mock is the default.

### `next/navigation`

Mock only the hooks a test uses, and let the mock share state with the assertions. For example,
[`src/hooks/useTransactionFilters.test.ts`](../Dechat/dex_with_fiat_frontend/src/hooks/useTransactionFilters.test.ts)
keeps a mutable `URLSearchParams` that `push` updates:

```ts
let mockSearchParams = new URLSearchParams('tab=history');
const mockPush = vi.fn((url: string) => {
  const query = url.split('?')[1] ?? '';
  mockSearchParams = new URLSearchParams(query);
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/transactions',
  useSearchParams: () => mockSearchParams,
}));
```

### Fake timers

The Vitest configuration fakes `Date`, `setTimeout`, `clearTimeout`, `setInterval`, and
`clearInterval` (not `queueMicrotask`). Tests that need timer control call `vi.useFakeTimers()`
in `beforeEach` and always restore with `vi.useRealTimers()` in `afterEach`; async hook tests use
`await vi.advanceTimersByTimeAsync(...)`. For deterministic dates, freeze the clock with
`vi.setSystemTime(new Date('...'))`. See `useCurrencyConversion.test.tsx`, `rateLimit.test.ts`,
and `chatSearch.test.ts` for concrete patterns.

### Fixtures

There is no shared `__fixtures__` directory: fixtures are inline module-level constants or
factory functions in the test file (for example, the fixed sessions in
`/test-chat-search-panel` and the mock Stellar accounts and ledger setup in
`Dechat/stellar-contracts/src/test.rs`). Contract tests use `Env::default()`,
`env.mock_all_auths()`, `Address::generate`, and `env.ledger().with_mut(...)` for time/ledger
control. `proptest-regressions/test.txt` is checked in and holds generated regression seeds.

### Mock setup and cleanup

A stable pattern in `StellarWalletContext.test.tsx` is a hoisted mock object plus explicit
resets:

```ts
const freighter = vi.hoisted(() => ({
  isConnected: vi.fn(), getAddress: vi.fn(), getNetwork: vi.fn(),
  requestAccess: vi.fn(), signTransaction: vi.fn(), setAllowed: vi.fn(),
}));
vi.mock('@stellar/freighter-api', () => freighter);

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // seed resolved values used by the assertions
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
```

Other suites use `vi.resetAllMocks()` / `vi.restoreAllMocks()` and `vi.unstubAllEnvs()`, and
component tests may call Testing Library's `cleanup()`. The important rule is that every test
leaves timers, environment stubs, mocks, and shared queue state as it found them; the global
`afterEach` already covers only the network queue.

## Generated test snapshots

Two different snapshot mechanisms exist, and they follow different rules.

### Vitest component snapshots

[`EmptyState.test.tsx`](../Dechat/dex_with_fiat_frontend/src/components/ui/__tests__/EmptyState.test.tsx)
uses `toMatchSnapshot()` for five UI variants. The generated file is
[`__snapshots__/EmptyState.test.tsx.snap`](../Dechat/dex_with_fiat_frontend/src/components/ui/__tests__/__snapshots__/EmptyState.test.tsx.snap)
and **is tracked in git**. It contains serialized DOM fragments (classes and SVG markup).

- **What it represents:** the rendered output of the component at the time the snapshot was
  accepted.
- **When to review:** any change to the component or its styling that produces a snapshot diff.
  Review the diff in the pull request like a normal code change; do not accept changes you
  cannot explain.
- **Unexpected changes:** inspect the rendered diff first. If the change is intended, update the
  snapshot with Vitest's `-u` flag and commit the resulting `.snap` file. If it is not intended,
  fix the component or test instead of updating the snapshot.

### Soroban `test_snapshots/`

The Soroban SDK test host can write ledger/host snapshots to `test_snapshots/` (historically
under `Dechat/stellar-contracts/test_snapshots/`, with JSON files for named tests and events).
There is **no `test_snapshots/` directory in the current working tree**. The crate's
[`.gitignore`](../Dechat/stellar-contracts/.gitignore) lists `test_snapshots/`, and no files
under that path are tracked today. The event snapshot tests in `src/test.rs` construct their
environment with `capture_snapshot_at_drop: false`, and no current test or workflow asserts
against these JSON files.

- **What they represent:** captured Soroban host/ledger state (storage, auth, and event data),
  not frontend UI snapshots and not assertion fixtures read by the tests.
- **Should they be committed?** No, under the current convention: the directory is intentionally
  ignored, and historical snapshot files were removed from the repository. Treat locally
  generated files as disposable build artifacts.
- **Unexpected changes:** because no automated snapshot gate exists in the current workflows, a
  local snapshot appearing after a Cargo run is not by itself a test failure. Confirm whether it
  came from enabling host capture, review it locally if useful, and do not add it to git unless
  the repository convention changes.

## Specialized testing guides

Start here for general commands and conventions, then consult the feature-specific documents
for scenario details rather than duplicating them:

- [AdminGuard test coverage](../Dechat/dex_with_fiat_frontend/ADMIN_GUARD_TESTING.md) — the four
  authorization cases in `src/components/__tests__/AdminGuard.test.tsx`. Its historical
  `npm run test -- ...` command predates the current scripts; use the `pnpm test:unit <file>`
  form shown above.
- [Audit log testing](../Dechat/dex_with_fiat_frontend/AUDIT_LOG_TESTING.md) — implementation
  inventory, acceptance criteria, API query parameters, and manual UI verification for the
  admin audit log.
- [Invariant testing](../Dechat/stellar-contracts/docs/INVARIANT_TESTING.md) — accounting
  invariants, the registered invariant modules, how to register a new module in `lib.rs`, and
  property-versus-example guidance.
- [Fuzz test boundary guide](fuzz-test-boundary.md) — realistic input domains for arithmetic
  and chat state-machine tests, including fixed-point and receipt boundaries.
