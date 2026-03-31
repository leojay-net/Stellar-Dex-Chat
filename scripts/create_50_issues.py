#!/usr/bin/env python3
"""Create 50 new GitHub issues for Stellar-Dex-Chat."""
import subprocess
import sys

REPO = "leojay-net/Stellar-Dex-Chat"

issues = [
    # ── Smart Contract (17) ──────────────────────────────────────────────
    {
        "title": "feat(contract): add per-token daily deposit limits",
        "body": "## Summary\nCurrently there is a global deposit limit per token (`set_limit`). Add a separate daily/rolling-window cap so that a single depositor cannot flood escrow storage within 24 hours.\n\n## Acceptance Criteria\n- New `set_daily_deposit_limit(token, limit_per_day)` admin function\n- Tracked via `UserDailyDeposit(Address)` storage key with a window ledger\n- Existing single-tx limit still enforced independently\n- Tests cover boundary and reset behaviour",
        "labels": ["smart-contract", "enhancement", "complexity: medium"],
    },
    {
        "title": "feat(contract): emit structured events with schema version",
        "body": "## Summary\nAll contract events (deposit, withdrawal, fee, admin) should include `EVENT_VERSION` in their topic tuple so off-chain indexers can handle breaking schema changes gracefully.\n\n## Acceptance Criteria\n- Every `env.events().publish(...)` call includes `EVENT_VERSION` as the first topic element\n- Unit tests assert the event topic structure\n- Changelog entry added",
        "labels": ["smart-contract", "enhancement", "complexity: medium"],
    },
    {
        "title": "feat(contract): support multi-token fee accrual in withdraw_fees",
        "body": "## Summary\n`withdraw_fees` currently requires specifying one token at a time. Add a batch variant `withdraw_fees_batch(tokens: Vec<Address>)` that sweeps all accrued fees in one transaction.\n\n## Acceptance Criteria\n- New `withdraw_fees_batch` function\n- Validates admin auth once\n- Iterates tokens and transfers each accrued balance\n- Tests for partial and full batch",
        "labels": ["smart-contract", "enhancement", "complexity: medium"],
    },
    {
        "title": "feat(contract): operator inactivity auto-deregister",
        "body": "## Summary\nIf an operator does not call `heartbeat` within `inactivity_threshold` ledgers, they should be automatically de-registered on the next admin action or a dedicated `prune_inactive_operators` call.\n\n## Acceptance Criteria\n- New `prune_inactive_operators` function iterates stored operators\n- Compares `OperatorHeartbeat` against threshold\n- Emits `operator_pruned` event\n- Tests for active vs inactive operator",
        "labels": ["smart-contract", "enhancement", "complexity: high"],
    },
    {
        "title": "fix(contract): validate memo_hash length in deposit and request_withdrawal",
        "body": "## Summary\n`memo_hash: Option<BytesN<32>>` is accepted as-is. While the type enforces 32 bytes, callers providing a non-SHA-256 hash (e.g. all zeros) produce misleading event data.\n\n## Acceptance Criteria\n- Reject `memo_hash` that is all zeros with a new `Error::InvalidMemoHash`\n- Document the expected format (SHA-256 of external transaction metadata)\n- Add test asserting zero-hash rejection",
        "labels": ["smart-contract", "bug", "complexity: trivial"],
    },
    {
        "title": "feat(contract): add get_receipt_by_index query function",
        "body": "## Summary\nNow that `DataKey::ReceiptIndex(u64)` is stored on every deposit, expose a `get_receipt_by_index(idx: u64) -> Option<Receipt>` query so clients can paginate receipts without storing external indexes.\n\n## Acceptance Criteria\n- New `get_receipt_by_index` function\n- Uses `ReceiptIndex` to resolve hash then fetches `Receipt`\n- Returns `None` if index is out of range\n- Test covering valid index, out-of-range, and deleted receipt",
        "labels": [
            "smart-contract",
            "enhancement",
            "complexity: trivial",
            "good first issue",
        ],
    },
    {
        "title": "feat(contract): add configurable max operators cap",
        "body": "## Summary\nCurrently unlimited operators can be registered. Add a `max_operators` config that the admin can set, and reject `set_operator(active: true)` once the cap is reached.\n\n## Acceptance Criteria\n- New `set_max_operators(n: u32)` admin function\n- `set_operator` returns `Error::OperatorCapReached` if count >= max\n- Count maintained in `OperatorCount` instance storage key\n- Tests for cap enforcement and recovery after deactivation",
        "labels": ["smart-contract", "enhancement", "complexity: medium"],
    },
    {
        "title": "feat(contract): add is_denied query to public ABI",
        "body": "## Summary\n`is_denied` already exists in the impl but it is not covered by a dedicated integration test and is not listed in the client documentation.\n\n## Acceptance Criteria\n- Dedicated test `test_is_denied_returns_correct_value`\n- WASM ABI export verified with `soroban contract bindings`\n- Inline doc comment added to `is_denied` fn",
        "labels": [
            "smart-contract",
            "testing",
            "complexity: trivial",
            "good first issue",
        ],
    },
    {
        "title": "feat(contract): add withdraw quota reset event",
        "body": "## Summary\nWhen the daily withdrawal window resets and `UserDailyWithdrawal` is cleared, emit a `quota_reset` event so off-chain monitors can track windows.\n\n## Acceptance Criteria\n- Event emitted in the quota-reset code path inside `validate_withdrawal_quota`\n- Event includes `(user, window_start)` data\n- Test asserts event is present after window advance",
        "labels": ["smart-contract", "enhancement", "complexity: trivial"],
    },
    {
        "title": "feat(contract): add contract pause / unpause mechanism",
        "body": "## Summary\nIn an emergency the admin should be able to halt all deposits and withdrawals with a single `pause()` call and resume with `unpause()`.\n\n## Acceptance Criteria\n- `pause()` / `unpause()` admin functions\n- All state-changing user operations check `DataKey::Paused` and return `Error::ContractPaused`\n- Read-only queries unaffected\n- Tests for pause + deposit rejection and unpause + success",
        "labels": ["smart-contract", "enhancement", "complexity: high"],
    },
    {
        "title": "feat(contract): snapshot contract config for off-chain audit",
        "body": "## Summary\n`ConfigSnapshot` is defined but not exposed as a query function. Add `get_config_snapshot() -> ConfigSnapshot` so tooling can read the full admin configuration in one call.\n\n## Acceptance Criteria\n- New `get_config_snapshot` function\n- Assembles `ConfigSnapshot` from current storage\n- Test verifies snapshot matches individually fetched values",
        "labels": [
            "smart-contract",
            "enhancement",
            "complexity: trivial",
            "good first issue",
        ],
    },
    {
        "title": "feat(contract): add receipt TTL extension on pending withdrawal",
        "body": "## Summary\nReceipts stored in `persistent` storage have TTL set at deposit time. If a withdrawal request is pending, the receipt TTL should be extended to at least `lock_period + cooldown_ledgers` to avoid expiry.\n\n## Acceptance Criteria\n- `request_withdrawal` extends `DataKey::Receipt` TTL\n- Minimum TTL = lock_period + cooldown + MIN_TTL\n- Test exercises a deposit at near-expiry followed by withdrawal request",
        "labels": ["smart-contract", "bug", "complexity: medium"],
    },
    {
        "title": "fix(contract): prevent ReceiptIndex from using persistent storage for short-lived entries",
        "body": "## Summary\n`DataKey::ReceiptIndex(u64)` entries are stored in `persistent` storage with no explicit TTL matching the receipt. They should mirror the same TTL as their corresponding `DataKey::Receipt` entry to avoid orphaned index keys.\n\n## Acceptance Criteria\n- `ReceiptIndex` TTL extended in the same call as `Receipt` TTL\n- Comment explaining the invariant\n- Test verifies no orphan index after TTL mismatch scenario",
        "labels": ["smart-contract", "bug", "complexity: medium"],
    },
    {
        "title": "feat(contract): add FeeVault balance query",
        "body": "## Summary\nThere is no public read function for the current accrued fee balance per token. Expose `get_accrued_fees(token)` (already defined) in the ABI documentation and add it to the SDK bindings README.\n\n## Acceptance Criteria\n- `get_accrued_fees` covered by dedicated test\n- Listed in `FIAT_BRIDGE_README.md` under Public Queries\n- SDK TypeScript bindings regenerated and verified",
        "labels": [
            "smart-contract",
            "documentation",
            "complexity: trivial",
            "good first issue",
        ],
    },
    {
        "title": "feat(contract): add role-based emit for admin timelock events",
        "body": "## Summary\nWhen `queue_admin_action` and `execute_admin_action` are called, the emitted events should include the action type and target so monitoring dashboards can display pending admin operations.\n\n## Acceptance Criteria\n- Event emitted in `queue_admin_action` with action type\n- Event emitted in `execute_admin_action` with result\n- Tests verify event data",
        "labels": ["smart-contract", "enhancement", "complexity: medium"],
    },
    {
        "title": "test(contract): add fuzz-style boundary tests for SlippageTooHigh",
        "body": "## Summary\nThe `check_slippage` function uses a basis-points comparison. Add parameterised tests that sweep `max_slippage` from 0 to 10_000 bps and verify exact boundary behaviour.\n\n## Acceptance Criteria\n- `test_slippage_boundary_exact` — passes at exactly max_slippage bps\n- `test_slippage_boundary_exceeded` — fails at max_slippage + 1 bps\n- All assertions use `Err(Ok(Error::SlippageTooHigh))`",
        "labels": ["smart-contract", "testing", "complexity: medium"],
    },
    {
        "title": "feat(contract): add batch_set_allowed for allowlist management",
        "body": "## Summary\nAdding addresses to the allowlist one-by-one is expensive in gas. Add `batch_set_allowed(addresses: Vec<Address>, enabled: bool)` to whitelist or remove multiple addresses in a single transaction.\n\n## Acceptance Criteria\n- New admin function `batch_set_allowed`\n- Iterates addresses and sets/removes `DataKey::Allowed`\n- Bounded by `MAX_BATCH_SIZE` constant (e.g. 50)\n- Tests for batch add, batch remove, and oversize rejection",
        "labels": ["smart-contract", "enhancement", "complexity: medium"],
    },
    # ── Frontend (17) ──────────────────────────────────────────────────────
    {
        "title": "feat(frontend): add receipt ID display in chat deposit confirmation",
        "body": "## Summary\nWhen a deposit succeeds the AI chat response should display the receipt `BytesN<32>` ID (hex-encoded) so users can reference it for support.\n\n## Acceptance Criteria\n- Receipt ID displayed in the success message bubble\n- Truncated to `0x1234…abcd` format with copy-to-clipboard button\n- Visible in both dark and light mode",
        "labels": [
            "frontend",
            "enhancement",
            "complexity: trivial",
            "good first issue",
        ],
    },
    {
        "title": "feat(frontend): add withdrawal queue depth indicator",
        "body": "## Summary\nShow a real-time badge in the wallet panel indicating how many withdrawal requests are in the queue (`get_wq_depth`) so users know current settlement latency.\n\n## Acceptance Criteria\n- Fetches `get_wq_depth` from contract every 30 seconds\n- Displays badge on the withdrawal button\n- Colour-coded: green (0–5), yellow (6–20), red (>20)",
        "labels": ["frontend", "enhancement", "complexity: medium"],
    },
    {
        "title": "feat(frontend): add transaction history export to PDF",
        "body": "## Summary\njsPDF is installed. Implement an Export button on the chat history sidebar that generates a PDF of all chat transactions (deposits, withdrawals, receipts).\n\n## Acceptance Criteria\n- Table layout: Date | Type | Amount | Token | Receipt/Request ID\n- Footer with wallet address and export timestamp\n- File named `stellar-bridge-history-<date>.pdf`",
        "labels": ["frontend", "enhancement", "complexity: medium"],
    },
    {
        "title": "feat(frontend): add Zod validation schemas for all API route inputs",
        "body": "## Summary\nzod is installed but not used on API routes. Add Zod schemas to each `src/app/api/` route to validate and parse incoming request bodies before processing.\n\n## Acceptance Criteria\n- Each API handler imports and applies a Zod schema\n- Invalid payloads return HTTP 400 with structured error\n- No runtime type-cast workarounds remain in route handlers",
        "labels": ["frontend", "enhancement", "complexity: medium"],
    },
    {
        "title": "feat(frontend): animate chat message entrance with framer-motion",
        "body": "## Summary\nframer-motion is installed. Animate each new `Message` component with a slide-in-from-bottom fade animation to improve perceived performance.\n\n## Acceptance Criteria\n- `Message.tsx` wrapped with `motion.div` using `initial`, `animate`, `transition`\n- Animation does not replay on history load (only new messages)\n- Works with reduced-motion media query (uses `useReducedMotion()`)",
        "labels": [
            "frontend",
            "enhancement",
            "complexity: trivial",
            "good first issue",
        ],
    },
    {
        "title": "feat(frontend): add dark/light theme toggle to landing page",
        "body": "## Summary\n`ThemeContext` exists but the landing page (`LandingPage.tsx`) does not expose a toggle button.\n\n## Acceptance Criteria\n- Sun/moon icon button in top-right of LandingPage\n- Persists choice to `localStorage`\n- Smooth CSS variable transition (200ms)\n- Accessible with ARIA label",
        "labels": [
            "frontend",
            "enhancement",
            "complexity: trivial",
            "good first issue",
        ],
    },
    {
        "title": "fix(frontend): handle wallet disconnection without crashing chat",
        "body": "## Summary\nIf the user disconnects their wallet mid-session the `EthereumWalletContext` state goes undefined, causing unhandled errors in `ChatInput.tsx`.\n\n## Acceptance Criteria\n- `ChatInput` checks wallet state before submission\n- Shows inline warning: 'Wallet disconnected. Reconnect to continue.'\n- No uncaught React errors in console\n- Unit test mocking disconnected wallet state",
        "labels": ["frontend", "bug", "complexity: medium"],
    },
    {
        "title": "feat(frontend): add CCIP bridge status polling",
        "body": "## Summary\n`CCIPBridgeModal.tsx` initiates CCIP transfers but does not poll for completion. Add a status poller that checks the CCIP explorer API every 15 seconds and updates the modal state.\n\n## Acceptance Criteria\n- Spinner with 'Waiting for CCIP confirmation…' text\n- Green checkmark when `status === 'SUCCESS'`\n- Link to CCIP explorer transaction\n- Timeout after 10 minutes with error state",
        "labels": ["frontend", "enhancement", "complexity: high"],
    },
    {
        "title": "feat(frontend): add mobile-responsive layout for chat interface",
        "body": "## Summary\nThe chat interface (`/chat` route) is not optimized for mobile viewports < 640px. The sidebar overlaps the message list.\n\n## Acceptance Criteria\n- Sidebar collapses to an icon on mobile\n- Slide-out drawer navigation on mobile\n- ChatInput sticks to bottom on all screen sizes\n- Tested at 375px, 414px, and 768px widths",
        "labels": ["frontend", "enhancement", "complexity: high"],
    },
    {
        "title": "feat(frontend): show live crypto prices in chat sidebar",
        "body": "## Summary\n`cryptoPriceService.ts` fetches prices but they are only used inside AI responses. Display a live ticker in the sidebar showing XLM, ETH, and BTC prices refreshed every 60 seconds.\n\n## Acceptance Criteria\n- Ticker component in `ChatHistorySidebar.tsx`\n- 24h change percentage with color (green/red)\n- Graceful fallback on API error ('Prices unavailable')\n- No flicker on update",
        "labels": ["frontend", "enhancement", "complexity: medium"],
    },
    {
        "title": "fix(frontend): deduplicate chat history entries on page reload",
        "body": "## Summary\n`useChatHistory.ts` loads from storage and occasionally creates duplicate session entries when the page is reloaded quickly.\n\n## Acceptance Criteria\n- Dedup by session ID before writing to storage\n- Existing duplicate entries cleaned on first load\n- Unit test verifying idempotent load",
        "labels": ["frontend", "bug", "complexity: trivial"],
    },
    {
        "title": "feat(frontend): add error boundary around AI assistant chat",
        "body": "## Summary\nIf `aiAssistant.ts` throws an unhandled error, the entire `/chat` page crashes. Add a React error boundary that catches and displays a user-friendly fallback.\n\n## Acceptance Criteria\n- `ChatMessages.tsx` wrapped in `ErrorBoundary`\n- Fallback shows 'Chat unavailable. Please refresh.' with a retry button\n- Error logged to console (not surfaced raw to the user)\n- Test simulates thrown error in `ChatMessages`",
        "labels": ["frontend", "bug", "complexity: medium"],
    },
    {
        "title": "feat(frontend): add keyboard shortcut (Cmd+Enter) to submit chat",
        "body": "## Summary\nCurrently users must click the send button. Support `Cmd+Enter` (macOS) and `Ctrl+Enter` (Windows/Linux) to submit the chat input.\n\n## Acceptance Criteria\n- Event listener in `ChatInput.tsx`\n- Respects existing disabled state (contract pending)\n- Tooltip on button updates to show the shortcut\n- Works with screen reader announcements",
        "labels": [
            "frontend",
            "enhancement",
            "complexity: trivial",
            "good first issue",
        ],
    },
    {
        "title": "feat(frontend): add token balance display in Ethereum fiat modal",
        "body": "## Summary\n`EthereumFiatModal.tsx` does not show the user's current token balance before they enter an amount. Fetch and display the balance so users know their available funds.\n\n## Acceptance Criteria\n- Balance fetched via wagmi `useBalance` hook\n- Displayed as 'Available: X.XX TOKEN'\n- Updates on wallet connect/change\n- Handles loading and error states",
        "labels": ["frontend", "enhancement", "complexity: medium"],
    },
    {
        "title": "feat(frontend): add Paystack payment status webhook UI indicator",
        "body": "## Summary\nThe Paystack integration (`paystack.ts`) processes webhooks server-side. Add a UI toast notification that appears when a webhook confirmation is received for the current session.\n\n## Acceptance Criteria\n- Server-sent events (SSE) or polling endpoint for payment status\n- Toast: 'Payment confirmed!' or 'Payment failed – please retry'\n- Linked to `/api/webhook` handler\n- 5 second auto-dismiss",
        "labels": ["frontend", "enhancement", "complexity: high"],
    },
    {
        "title": "fix(frontend): fix hydration mismatch in Providers.tsx theme initialization",
        "body": "## Summary\nUsing `localStorage` in `Providers.tsx` during SSR causes a React hydration mismatch warning in Next.js.\n\n## Acceptance Criteria\n- Use `suppressHydrationWarning` or defer theme init to `useEffect`\n- No hydration warnings in browser console on page load\n- Theme still loads correctly without flash",
        "labels": ["frontend", "bug", "complexity: trivial"],
    },
    {
        "title": "feat(frontend): add accessible color contrast to all status badges",
        "body": "## Summary\nSeveral status badges (success, error, pending) fail WCAG 2.1 AA contrast ratio requirements.\n\n## Acceptance Criteria\n- Audit all badge color combinations with axe-core or similar\n- Update colors to meet 4.5:1 contrast ratio\n- Add visual regression test screenshots\n- Document color tokens updated",
        "labels": ["frontend", "enhancement", "complexity: medium"],
    },
    # ── Docs / DX / Testing / Infra (16) ────────────────────────────────
    {
        "title": "docs: add CONTRIBUTING guide for smart contract development",
        "body": "## Summary\nNew contributors lack a guide for setting up Soroban, running tests, and writing contract PRs.\n\n## Acceptance Criteria\n- `contracts/CONTRIBUTING.md`\n- Sections: Prerequisites, Local Setup, Running Tests, Writing New Functions, Submitting PRs\n- Links to `FIAT_BRIDGE_README.md` and Soroban docs",
        "labels": ["documentation", "dx", "complexity: trivial", "good first issue"],
    },
    {
        "title": "docs: update FIAT_BRIDGE_README with ReceiptIndex and BytesN<32> IDs",
        "body": "## Summary\nThe README still refers to `u64` receipt IDs. Update it to reflect the new deterministic `BytesN<32>` IDs and the `ReceiptIndex` enumeration pattern.\n\n## Acceptance Criteria\n- 'Receipt ID' section updated\n- Example showing hex-encoded SHA-256 receipt ID from TypeScript\n- Migration notes for integrators on the type change",
        "labels": ["documentation", "complexity: trivial", "good first issue"],
    },
    {
        "title": "ci: add cargo clippy step to GitHub Actions workflow",
        "body": "## Summary\nThe CI pipeline runs `cargo test` but not `cargo clippy`. Lint errors accumulate silently.\n\n## Acceptance Criteria\n- Clippy step added after build step with `-- -D warnings`\n- Fixes for all existing clippy warnings already present\n- Failure blocks merge",
        "labels": ["dx", "enhancement", "complexity: trivial"],
    },
    {
        "title": "ci: add Next.js build check to GitHub Actions",
        "body": "## Summary\nThe CI doesn't run `npm run build` on the frontend, allowing broken frontend PRs to merge.\n\n## Acceptance Criteria\n- Workflow step runs `npm ci && npm run build` in `dex_with_fiat_frontend`\n- Build artifacts cached with `actions/cache`\n- Failure blocks merge",
        "labels": ["dx", "enhancement", "complexity: trivial"],
    },
    {
        "title": "test(contract): add property-based tests with proptest for deposit amount",
        "body": "## Summary\nUse `proptest` crate to generate random `amount` values and verify the deposit invariants hold for all positive amounts below `config.limit`.\n\n## Acceptance Criteria\n- `proptest` added to `[dev-dependencies]`\n- `proptest!` macro covering deposit amount range 1..=config_limit\n- Shrinking produces minimal failing example on failure",
        "labels": ["testing", "smart-contract", "complexity: high"],
    },
    {
        "title": "test(frontend): add Playwright E2E test for deposit flow",
        "body": "## Summary\nNo end-to-end tests exist for the frontend deposit flow. Add a Playwright test that drives the chat interface through a mock deposit.\n\n## Acceptance Criteria\n- Playwright installed as dev dependency\n- Test: connect wallet → type 'deposit 100 USDC' → verify success message\n- Mocks contract call via page intercept\n- Runs in CI",
        "labels": ["testing", "frontend", "complexity: high"],
    },
    {
        "title": "dx: add pre-commit hooks with husky for contract lint",
        "body": "## Summary\nAdd husky + lint-staged to run `cargo clippy` (for .rs changes) and `eslint` (for .ts changes) before every commit.\n\n## Acceptance Criteria\n- husky + lint-staged configured\n- `cargo clippy` runs on staged `.rs` files\n- ESLint runs on staged `.ts/.tsx` files\n- Setup documented in README",
        "labels": ["dx", "enhancement", "complexity: medium"],
    },
    {
        "title": "docs: create architecture diagram for FiatBridge contract",
        "body": "## Summary\nNew contributors struggle to understand the full flow: deposit → receipt → withdrawal queue → execution. Add a Mermaid diagram to the README.\n\n## Acceptance Criteria\n- Mermaid diagram in `contracts/README.md`\n- Shows: user → deposit → Receipt+ReceiptIndex → request_withdrawal → execute_withdrawal\n- Admin path: set_operator, accrue_fee, withdraw_fees shown separately",
        "labels": ["documentation", "dx", "complexity: trivial", "good first issue"],
    },
    {
        "title": "test(contract): add test for execute_batch_admin with mixed success/failure ops",
        "body": "## Summary\nThe `execute_batch_admin` function processes operations and returns a `BatchResult` with counts. Test that partial failures are handled correctly and the function does not revert on single op failure.\n\n## Acceptance Criteria\n- Test batch of 3 ops where op 2 is invalid\n- `BatchResult.success_count` == 2, `failure_count` == 1\n- Contract state reflects only the 2 successful ops",
        "labels": ["testing", "smart-contract", "complexity: medium"],
    },
    {
        "title": "dx: add Soroban contract size budget check to CI",
        "body": "## Summary\nSoroban WASM has a 64 KB size limit. Add a CI step that builds the WASM and fails if it exceeds 55 KB (giving a 9 KB buffer).\n\n## Acceptance Criteria\n- Shell step: `ls -la target/wasm32-unknown-unknown/release/*.wasm` and `awk` check\n- Fails if > 55000 bytes\n- Prints current size in CI log",
        "labels": ["dx", "smart-contract", "complexity: trivial"],
    },
    {
        "title": "docs: document all Error codes in FIAT_BRIDGE_README",
        "body": "## Summary\nThe `Error` enum has ~30 variants across multiple series (100s, 200s, 300s…). Add a table to the README listing every code, series name, and when it is returned.\n\n## Acceptance Criteria\n- Markdown table with columns: Code | Name | Description | Returned By\n- All current error variants covered\n- Kept in sync via a CI doc-check script",
        "labels": ["documentation", "complexity: medium"],
    },
    {
        "title": "test(contract): add test for quota per-user isolation after window reset",
        "body": "## Summary\nVerify that resetting the withdrawal window for user A does not inadvertently reset user B's quota.\n\n## Acceptance Criteria\n- Test creates users A and B, both make withdrawals\n- Advance ledger past user A's window\n- User A quota resets; user B's quota unchanged\n- Both users can withdraw independently after",
        "labels": ["testing", "smart-contract", "complexity: medium"],
    },
    {
        "title": "dx: add VSCode workspace settings for Rust Analyzer in stellar-contracts",
        "body": "## Summary\nContributors on VSCode need to configure `rust-analyzer.linkedProjects` to point at `stellar-contracts/Cargo.toml` for IDE support.\n\n## Acceptance Criteria\n- `.vscode/settings.json` added with `rust-analyzer.linkedProjects` pointing at the contracts workspace\n- `.vscode/extensions.json` recommends `rust-lang.rust-analyzer`\n- Documented in CONTRIBUTING",
        "labels": ["dx", "complexity: trivial", "good first issue"],
    },
    {
        "title": "feat(infra): add Foundry deployment script for FiatBridge on Futurenet",
        "body": "## Summary\nFoundry scripts exist for some targets. Add a `DeployFiatBridgeFuturenet.s.sol` script (or equivalent Soroban deploy script) for automated Futurenet deployments in CI.\n\n## Acceptance Criteria\n- Deploy script parameterised by environment variable\n- Outputs contract ID to a file for downstream scripts\n- GitHub Actions workflow that deploys on push to `release/*` branches",
        "labels": ["enhancement", "dx", "complexity: high"],
    },
    {
        "title": "test(contract): add snapshot tests for all new event emissions",
        "body": "## Summary\nSoroban's snapshot test infrastructure captures event output. Add snapshot tests for all events added in recent PRs: `heartbeat`, `deny_add`, `deny_rem`, `quota_reset`, `fee_accrued`, `fees_withdrawn`.\n\n## Acceptance Criteria\n- One snapshot test per new event\n- Snapshot files committed to `test_snapshots/`\n- CI fails on snapshot mismatch",
        "labels": ["testing", "smart-contract", "complexity: medium"],
    },
    {
        "title": "docs: add SDK usage examples for TypeScript client bindings",
        "body": "## Summary\nDocument how to call the new contract functions (heartbeat, deny_address, migrate_escrow, execute_batch_admin) from the TypeScript SDK generated by `soroban contract bindings typescript`.\n\n## Acceptance Criteria\n- `docs/typescript-sdk-examples.md` created\n- Code snippets for each new function\n- Error handling patterns demonstrated\n- Link from main README",
        "labels": ["documentation", "dx", "smart-contract", "complexity: medium"],
    },
]


def create_issue(title, body, labels):
    label_args = []
    for label in labels:
        label_args += ["--label", label]
    cmd = [
        "gh",
        "issue",
        "create",
        "--repo",
        REPO,
        "--title",
        title,
        "--body",
        body,
    ] + label_args
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        url = result.stdout.strip()
        print(f"  Created: {title[:60]} -> {url}")
        return True
    else:
        print(f"  FAILED: {title[:60]}")
        print(f"  stderr: {result.stderr[:200]}")
        return False


def main():
    print(f"Creating {len(issues)} issues in {REPO}...\n")
    success = 0
    for i, issue in enumerate(issues, 1):
        print(f"[{i}/{len(issues)}]", end=" ")
        if create_issue(issue["title"], issue["body"], issue["labels"]):
            success += 1
    print(f"\nDone: {success}/{len(issues)} issues created.")


if __name__ == "__main__":
    main()
