import subprocess

REPO = "leojay-net/Stellar-Dex-Chat"

ISSUES = [
    (
        "Wave Feature: wallet network mismatch assistant",
        "enhancement,frontend,complexity: trivial",
        [
            "Show a clear network badge and mismatch warning before any write action.",
            "Disable deposit and withdraw actions when not on Testnet.",
            "Add one-click guidance text for switching network in Freighter.",
        ],
        "src/contexts/StellarWalletContext.tsx, src/components/StellarChatInterface.tsx",
    ),
    (
        "Wave Feature: multi-account wallet selector",
        "enhancement,frontend,complexity: medium",
        [
            "Add account switcher dropdown in header for connected wallet.",
            "Update active account in all contract calls and chat context.",
            "Persist selected account for session restore.",
        ],
        "src/contexts/StellarWalletContext.tsx, src/components/StellarChatInterface.tsx",
    ),
    (
        "Wave Feature: wallet session TTL and secure reconnect",
        "enhancement,frontend,complexity: medium",
        [
            "Store connection timestamp and enforce 24-hour expiry.",
            "Clear stale wallet state on expiry and request reconnect.",
            "Show a user-facing message explaining expired session.",
        ],
        "src/contexts/StellarWalletContext.tsx",
    ),
    (
        "Wave Feature: pre-sign transaction summary modal",
        "enhancement,frontend,complexity: medium",
        [
            "Render operation type, amount, network, and contract id before signing.",
            "Require explicit confirmation before invoking signTransaction.",
            "Support cancel and return to editable form state.",
        ],
        "src/components/StellarFiatModal.tsx, src/lib/stellarContract.ts",
    ),
    (
        "Wave Feature: transaction fee estimate before submit",
        "enhancement,frontend,complexity: medium",
        [
            "Extract estimated fee from simulation response.",
            "Display fee estimate in XLM in deposit and withdraw flow.",
            "Gracefully handle unavailable estimate without blocking submit.",
        ],
        "src/lib/stellarContract.ts, src/components/StellarFiatModal.tsx",
    ),
    (
        "Wave Feature: pending transaction recovery after refresh",
        "enhancement,frontend,complexity: medium",
        [
            "Persist pending transaction metadata in local storage.",
            "Recover status on page load and restore progress state.",
            "Clear recovery state after terminal result.",
        ],
        "src/lib/stellarContract.ts, src/components/StellarFiatModal.tsx",
    ),
    (
        "Wave Feature: duplicate submit protection and safe retry",
        "enhancement,frontend,complexity: medium",
        [
            "Disable submit while in-flight and add cooldown to prevent spam clicks.",
            "Show retry action only on confirmed failure.",
            "Track idempotency key for each submit attempt in UI state.",
        ],
        "src/components/StellarFiatModal.tsx",
    ),
    (
        "Wave Feature: downloadable receipt for successful operations",
        "enhancement,frontend,complexity: medium",
        [
            "Add Download Receipt action on success state.",
            "Include tx hash, amount, wallet, network, and timestamp.",
            "Generate receipt on client without backend dependency.",
        ],
        "src/components/StellarFiatModal.tsx, src/lib/receipt.ts",
    ),
    (
        "Wave Feature: saved beneficiary templates",
        "enhancement,frontend,complexity: medium",
        [
            "Allow saving verified bank beneficiaries for reuse.",
            "Provide select, rename, and delete controls.",
            "Persist beneficiary templates locally.",
        ],
        "src/components/BankDetailsModal.tsx, src/hooks/useBeneficiaries.ts",
    ),
    (
        "Wave Feature: payout status timeline component",
        "enhancement,frontend,complexity: medium",
        [
            "Render timeline states initiated, pending, success, failed, reversed.",
            "Display timestamps for each status transition.",
            "Update timeline using transfer status polling.",
        ],
        "src/components/BankDetailsModal.tsx, src/components/TransferTimeline.tsx",
    ),
    (
        "Wave Feature: payout cancellation request in short grace period",
        "enhancement,frontend,complexity: high",
        [
            "Expose Cancel action for newly initiated payouts within 2 minutes.",
            "Create backend route to mark cancellation request state.",
            "Display cancellation status in timeline and history.",
        ],
        "src/app/api/initiate-transfer/route.ts, src/app/api/transfer-status/[reference]/route.ts",
    ),
    (
        "Wave Feature: quote lock countdown for fiat estimate",
        "enhancement,frontend,complexity: medium",
        [
            "Lock payout quote for 120 seconds during review step.",
            "Show visible countdown and expiration warning.",
            "Require requote after expiration before final submit.",
        ],
        "src/components/BankDetailsModal.tsx, src/lib/cryptoPriceService.ts",
    ),
    (
        "Wave Feature: webhook replay protection cache",
        "enhancement,dx,complexity: medium",
        [
            "Add in-memory replay cache keyed by event id or payload hash.",
            "Ignore duplicate events safely and log replay detection.",
            "Apply TTL and bounded cache size to avoid memory growth.",
        ],
        "src/app/api/webhook/route.ts, src/lib/transferStore.ts",
    ),
    (
        "Wave Feature: admin reconciliation dashboard",
        "enhancement,frontend,complexity: high",
        [
            "Add admin page listing deposits and linked payout references.",
            "Filter by status and date range.",
            "Support CSV export for reconciliation records.",
        ],
        "src/app/admin/reconciliation/page.tsx",
    ),
    (
        "Wave Feature: deterministic parser before AI extraction",
        "enhancement,frontend,complexity: medium",
        [
            "Create parser for amount, token, and fiat currency using regex rules.",
            "Merge parser output with AI output using parser precedence for numeric fields.",
            "Add parser tests for common and edge prompts.",
        ],
        "src/lib/messageParser.ts, src/lib/aiAssistant.ts",
    ),
    (
        "Wave Feature: low-confidence intent clarification flow",
        "enhancement,frontend,complexity: medium",
        [
            "Add confidence threshold gate for transaction progression.",
            "Ask targeted clarifying question when confidence is low.",
            "Prevent modal auto-open until confidence recovers.",
        ],
        "src/hooks/useChat.ts, src/lib/aiAssistant.ts",
    ),
    (
        "Wave Feature: AI guardrails for unsupported requests",
        "enhancement,frontend,complexity: medium",
        [
            "Classify unsupported or risky requests before normal handling.",
            "Return safe response template with valid next actions.",
            "Capture guardrail trigger counts for maintainers.",
        ],
        "src/lib/aiAssistant.ts",
    ),
    (
        "Wave Feature: slash command shortcuts in chat",
        "enhancement,frontend,complexity: trivial",
        [
            "Support /deposit, /rates, /portfolio, /help commands.",
            "Show command autocomplete as user types slash.",
            "Handle unknown commands with helpful fallback.",
        ],
        "src/components/ChatInput.tsx, src/hooks/useChat.ts",
    ),
    (
        "Wave Feature: contextual help cards for first-time users",
        "enhancement,frontend,complexity: trivial",
        [
            "Show setup cards for wallet connect, deposit, and payout steps.",
            "Allow dismissing cards and persist dismissal state.",
            "Attach one-click action buttons in each card.",
        ],
        "src/components/ChatMessages.tsx",
    ),
    (
        "Wave Feature: export chat sessions as JSON and text",
        "enhancement,frontend,complexity: trivial",
        [
            "Add Export JSON and Export TXT actions in chat history.",
            "Include timestamps and role labels in exported data.",
            "Use filename convention with session id and date.",
        ],
        "src/components/ChatHistorySidebar.tsx, src/lib/chatHistory.ts",
    ),
    (
        "Wave Feature: dynamic follow-up suggestions via state machine",
        "enhancement,frontend,complexity: medium",
        [
            "Build state machine for wallet, amount, and payout readiness.",
            "Generate suggestions based on current state.",
            "Add tests for core state transitions.",
        ],
        "src/hooks/useChat.ts, src/lib/conversationStateMachine.ts",
    ),
    (
        "Wave Feature: unusual amount risk confirmation",
        "enhancement,frontend,complexity: medium",
        [
            "Introduce threshold-based warning for large amounts.",
            "Require typed confirmation phrase for risky values.",
            "Log risk warning events for review.",
        ],
        "src/components/StellarFiatModal.tsx, src/hooks/useChat.ts",
    ),
    (
        "Wave Feature: local FAQ retrieval before model call",
        "enhancement,frontend,complexity: medium",
        [
            "Create FAQ map for frequent user questions.",
            "Resolve high-confidence FAQ hits without model request.",
            "Fallback to model when FAQ confidence is low.",
        ],
        "src/lib/faq.ts, src/lib/aiAssistant.ts",
    ),
    (
        "Wave Feature: admin overview dashboard with key metrics",
        "enhancement,frontend,complexity: high",
        [
            "Show bridge balance, total deposited, pending payouts, failed payouts.",
            "Auto-refresh dashboard data every 30 seconds.",
            "Guard route with admin wallet check.",
        ],
        "src/app/admin/page.tsx, src/lib/adminMetrics.ts",
    ),
    (
        "Wave Feature: health endpoint and status badge",
        "enhancement,dx,complexity: trivial",
        [
            "Add API health endpoint with status and timestamp.",
            "Show health badge in chat header.",
            "Poll health endpoint every minute.",
        ],
        "src/app/api/health/route.ts, src/components/StellarChatInterface.tsx",
    ),
    (
        "Wave Feature: recent contract activity feed from indexed events",
        "enhancement,dx,complexity: high",
        [
            "Implement event indexing job for deposit and withdraw logs.",
            "Expose indexed feed via API endpoint.",
            "Render activity list in sidebar.",
        ],
        "scripts/index-events.ts, src/app/api/events/route.ts, src/components/ChatHistorySidebar.tsx",
    ),
    (
        "Wave Feature: daily volume and active wallets charts",
        "enhancement,frontend,complexity: medium",
        [
            "Aggregate daily metrics for 30-day window.",
            "Render chart widgets in admin view.",
            "Provide zero-data fallback states.",
        ],
        "src/app/admin/page.tsx, src/lib/analytics.ts",
    ),
    (
        "Wave Feature: role-based display of admin actions",
        "enhancement,frontend,complexity: medium",
        [
            "Only show admin controls for configured admin wallet.",
            "Hide admin actions entirely for regular users.",
            "Preserve existing user flows unchanged.",
        ],
        "src/components/StellarChatInterface.tsx, src/components/StellarFiatModal.tsx",
    ),
    (
        "Wave Feature: append-only admin audit log",
        "enhancement,dx,complexity: medium",
        [
            "Record admin action metadata and tx hash in append-only log.",
            "Expose read-only API endpoint for audit entries.",
            "Render filterable audit table in admin page.",
        ],
        "src/lib/auditLog.ts, src/app/api/admin-audit/route.ts, src/app/admin/page.tsx",
    ),
    (
        "Wave Feature: feature-flag framework for staged rollouts",
        "enhancement,dx,complexity: medium",
        [
            "Create typed feature flag registry.",
            "Add hook for reading flags in components.",
            "Gate at least two modules behind flags.",
        ],
        "src/lib/featureFlags.ts, src/hooks/useFeatureFlag.ts",
    ),
    (
        "Wave Feature: API rate limiting for payout routes",
        "enhancement,dx,complexity: medium",
        [
            "Apply per-IP limits to verify-account, create-recipient, initiate-transfer routes.",
            "Return HTTP 429 with retry-after value when exceeded.",
            "Log rate-limit events with route and ip metadata.",
        ],
        "src/lib/rateLimit.ts, src/app/api/verify-account/route.ts, src/app/api/create-recipient/route.ts, src/app/api/initiate-transfer/route.ts",
    ),
    (
        "Wave Feature: optional IP allowlist for sensitive admin operations",
        "enhancement,dx,complexity: medium",
        [
            "Read allowlist from env and apply to admin-sensitive routes.",
            "Reject non-allowlisted requests with HTTP 403.",
            "Provide local development bypass switch.",
        ],
        "src/lib/security.ts, src/app/api/admin-audit/route.ts",
    ),
    (
        "Wave Feature: startup validation for required environment variables",
        "enhancement,dx,complexity: trivial",
        [
            "Create centralized env schema validation.",
            "Fail fast with descriptive error for missing required secrets.",
            "Support safe defaults for optional variables.",
        ],
        "src/lib/env.ts, src/app/api/*",
    ),
    (
        "Wave Feature: Sentry integration for frontend and API",
        "enhancement,dx,complexity: medium",
        [
            "Integrate Sentry SDK for Next.js app and server routes.",
            "Capture unhandled exceptions and key transaction errors.",
            "Document required DSN variables in env template.",
        ],
        "dex_with_fiat_frontend/sentry.* files, src/app/api/*",
    ),
    (
        "Wave Feature: OpenTelemetry traces for payout lifecycle",
        "enhancement,dx,complexity: high",
        [
            "Add request correlation ids across payout-related routes.",
            "Instrument key steps with trace spans.",
            "Expose trace id in logs for debugging.",
        ],
        "src/lib/telemetry.ts, src/app/api/*",
    ),
    (
        "Wave Feature: keyboard accessibility for chat and modals",
        "enhancement,frontend,complexity: medium",
        [
            "Ensure keyboard navigation and focus visibility for all controls.",
            "Trap focus inside open modal and restore focus on close.",
            "Add aria labels for icon-only buttons.",
        ],
        "src/components/ChatInput.tsx, src/components/StellarFiatModal.tsx",
    ),
    (
        "Wave Feature: reusable skeleton loading components",
        "enhancement,frontend,complexity: trivial",
        [
            "Add skeleton variants for header stats, chat history, and payout steps.",
            "Replace abrupt empty placeholders with skeleton states.",
            "Avoid layout shift when data loads.",
        ],
        "src/components/ui/*, src/components/StellarChatInterface.tsx",
    ),
    (
        "Wave Feature: offline banner and queued retries for read requests",
        "enhancement,frontend,complexity: medium",
        [
            "Show offline indicator when network drops.",
            "Queue failed read-only requests and retry when online.",
            "Do not auto-retry write actions requiring wallet signatures.",
        ],
        "src/lib/networkQueue.ts, src/components/StellarChatInterface.tsx",
    ),
    (
        "Wave Feature: mobile bottom-sheet pattern for chat history",
        "enhancement,frontend,complexity: medium",
        [
            "Replace sidebar with bottom-sheet on small screens.",
            "Support overlay click and swipe-down close.",
            "Keep desktop sidebar behavior unchanged.",
        ],
        "src/components/StellarChatInterface.tsx, src/components/ChatHistorySidebar.tsx",
    ),
    (
        "Wave Feature: token-based theme system refactor",
        "enhancement,frontend,complexity: medium",
        [
            "Define theme tokens for primary, surface, text, border, and status colors.",
            "Refactor major components to use token classes or variables.",
            "Verify light and dark parity without visual regressions.",
        ],
        "src/app/globals.css, src/contexts/ThemeContext.tsx, src/components/*",
    ),
    (
        "Wave Feature: notifications center for tx and payout events",
        "enhancement,frontend,complexity: medium",
        [
            "Add notifications panel with unread counter.",
            "Emit notifications for tx submit, confirm, payout pending, payout success, payout fail.",
            "Persist recent notifications locally.",
        ],
        "src/components/NotificationsCenter.tsx, src/hooks/useNotifications.ts",
    ),
    (
        "Wave Feature: deposit-limit progress meter",
        "enhancement,frontend,complexity: trivial",
        [
            "Show requested amount relative to contract limit in modal.",
            "Warn at high percentage threshold and block over-limit values.",
            "Use current on-chain limit from view call.",
        ],
        "src/components/StellarFiatModal.tsx, src/lib/stellarContract.ts",
    ),
    (
        "Wave Feature: recurring conversion reminder settings",
        "enhancement,frontend,complexity: trivial",
        [
            "Add settings for weekly and monthly reminders.",
            "Persist reminder preferences in local storage.",
            "Show reminder card when schedule is due.",
        ],
        "src/components/UserSettings.tsx, src/hooks/useReminders.ts",
    ),
    (
        "Wave Feature: transaction notes and labels",
        "enhancement,frontend,complexity: trivial",
        [
            "Allow optional note input during deposit and payout steps.",
            "Store note with transaction history entry.",
            "Render note in transaction history and exports.",
        ],
        "src/components/StellarFiatModal.tsx, src/hooks/useTxHistory.ts",
    ),
    (
        "Wave Feature: quick amount preset chips in deposit modal",
        "enhancement,frontend,complexity: trivial,good first issue",
        [
            "Add one-click amount presets such as 5, 10, 25, 50, 100 XLM.",
            "Selecting preset updates amount field immediately.",
            "Allow manual override after preset selection.",
        ],
        "src/components/StellarFiatModal.tsx",
    ),
    (
        "Wave Feature: fiat currency preference and defaults",
        "enhancement,frontend,complexity: medium",
        [
            "Provide user setting for default fiat currency.",
            "Apply preference to quote and conversion display.",
            "Persist preference and restore on load.",
        ],
        "src/components/UserSettings.tsx, src/lib/cryptoPriceService.ts",
    ),
    (
        "Wave Feature: payout provider abstraction layer",
        "enhancement,dx,complexity: high",
        [
            "Define provider interface for verify, recipient create, transfer initiate, status check.",
            "Implement current provider through new interface.",
            "Refactor API routes to use provider registry.",
        ],
        "src/lib/payout/providers/*, src/app/api/*",
    ),
    (
        "Wave Feature: advanced simulation details panel",
        "enhancement,frontend,complexity: medium",
        [
            "Expose optional simulation diagnostics for advanced users.",
            "Show simulation status and selected return fields.",
            "Hide panel by default behind Advanced toggle.",
        ],
        "src/lib/stellarContract.ts, src/components/StellarFiatModal.tsx",
    ),
    (
        "Wave Feature: cache layer for frequent contract view calls",
        "enhancement,frontend,complexity: trivial",
        [
            "Add short TTL cache for get_balance, get_limit, get_total_deposited.",
            "Invalidate cache after successful write transaction.",
            "Provide manual refresh trigger in UI.",
        ],
        "src/lib/stellarContract.ts, src/hooks/useBridgeStats.ts",
    ),
    (
        "Wave Feature: benchmark script for latency and render timings",
        "enhancement,dx,complexity: medium",
        [
            "Measure simulate, submit, and confirm latency for tx flow.",
            "Measure first render and first AI response timings.",
            "Output report in markdown for baseline tracking.",
        ],
        "scripts/benchmark.ts, src/lib/perf.ts",
    ),
    (
        "Wave Feature: Playwright end-to-end suite for core journey",
        "enhancement,testing,complexity: high",
        [
            "Add e2e test for connect wallet UI path.",
            "Add e2e test for deposit modal validation and success state.",
            "Add e2e test for payout form and mocked transfer initiation.",
        ],
        "dex_with_fiat_frontend/tests/e2e/*, dex_with_fiat_frontend/playwright.config.ts",
    ),
    (
        "Wave Feature: unit tests for chat flow state transitions",
        "enhancement,testing,complexity: medium",
        [
            "Test cancellation, pending data merge, and auto-trigger logic.",
            "Mock AI outputs to keep tests deterministic.",
            "Reach at least 80 percent coverage for useChat core module.",
        ],
        "src/hooks/useChat.ts, tests/useChat.test.ts",
    ),
    (
        "Wave Feature: property-based tests for contract amount invariants",
        "enhancement,testing,smart-contract,complexity: medium",
        [
            "Assert deposit rejects non-positive and over-limit values across ranges.",
            "Assert total deposited remains monotonic for valid deposits.",
            "Assert withdraw never succeeds beyond contract balance.",
        ],
        "stellar-contracts/src/test.rs",
    ),
    (
        "Wave Feature: staging deployment previews for pull requests",
        "enhancement,dx,complexity: medium",
        [
            "Deploy preview environment per pull request.",
            "Post preview URL comment automatically on PR.",
            "Remove preview when PR closes.",
        ],
        ".github/workflows/*, hosting config files",
    ),
    (
        "Wave Feature: CI check for semantic PR titles and commits",
        "enhancement,dx,complexity: trivial",
        [
            "Validate PR title starts with feat, fix, docs, test, or chore.",
            "Validate commit format for merge strategy in use.",
            "Document expected format in contributing guide.",
        ],
        ".github/workflows/*, CONTRIBUTING.md",
    ),
    (
        "Wave Feature: automated changelog generation for releases",
        "enhancement,dx,complexity: medium",
        [
            "Generate release notes grouped by labels.",
            "Update CHANGELOG.md on new release tags.",
            "Exclude internal-only chores from default notes.",
        ],
        ".github/workflows/release.yml, CHANGELOG.md",
    ),
]


def make_body(acceptance, files):
    return (
        "## Background\n\n"
        "This feature is scoped for one Wave and targets meaningful product or developer impact.\n\n"
        "## Goal\n\n"
        "Implement the feature in a production-ready way with clear validation output.\n\n"
        "## Acceptance Criteria\n\n"
        + "\n".join(f"- {line}" for line in acceptance)
        + "\n\n## Key Files\n\n"
        + files
        + "\n\n## Review Expectations\n\n"
        "- Keep implementation within one Wave cycle.\n"
        "- Add Closes #ISSUE_NUMBER in the pull request description.\n"
        "- Include screenshots or logs proving acceptance criteria.\n"
    )


if __name__ == "__main__":
    created = []
    for idx, (title, labels, acceptance, files) in enumerate(ISSUES, start=1):
        body = make_body(acceptance, files)
        cmd = [
            "gh",
            "issue",
            "create",
            "--repo",
            REPO,
            "--title",
            title,
            "--label",
            labels,
            "--body",
            body,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"FAILED at {idx}: {title}")
            print(result.stderr.strip() or result.stdout.strip())
            raise SystemExit(1)
        url = result.stdout.strip().splitlines()[-1]
        created.append(url)
        print(f"{idx:02d}. {url}")

    print(f"TOTAL_CREATED={len(created)}")
