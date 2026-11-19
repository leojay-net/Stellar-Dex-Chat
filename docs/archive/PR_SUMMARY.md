# PR Summary: CI, Build, and Documentation Improvements (#1451, #1452, #1453, #1454)

This PR resolves 4 related issues that improve the CI/CD pipeline, build configuration, environment variable management, and Docker setup after the `Dechat/` directory restructure.

---

## 🎯 Issues Resolved

- **#1451**: ci: fold frontend-build.yml into frontend.yml and stop building the app three times
- **#1452**: ci: pass the env var names the frontend actually reads
- **#1453**: docs: reconcile both .env.example files with the variables src/lib/env.ts actually reads
- **#1454**: build: fix docker-compose.yml and .env.docker after the Dechat/ move

---

## 📝 Changes Made

### Issue #1451: Consolidate Frontend CI Workflows

#### What Changed
- **Deleted** `.github/workflows/frontend-build.yml` (was building on every PR with no paths filter)
- **Enhanced** `.github/workflows/frontend.yml` to:
  - Build `.next/` **once** in the `build` job
  - Upload `.next/` as an artifact
  - Download the artifact in the `e2e` job (no rebuild)
  - Moved env vars to job-level `env:` block (no duplication)
  - Added `env-check` job that validates workflow env vars against `src/lib/env.ts`
- **Updated** `.github/workflows/auto-merge.yml`:
  - Removed `"Frontend Build Check"` from workflow_run triggers
  - Now only listens to `"Frontend CI"`, `"Smart Contract CI"`, and `"Contract Tests"`
- **Kept** `paths:` filter so contract-only PRs skip frontend CI

#### Benefits
- ✅ Frontend builds **once per PR** instead of 3 times (2-3x faster CI)
- ✅ Contract-only PRs don't trigger frontend builds
- ✅ Consistent env var configuration across all jobs
- ✅ Automatic validation prevents setting unused env vars

---

### Issue #1452: Fix Environment Variable Names

#### What Changed
- **Replaced** obsolete variable names with the correct ones from `src/lib/env.ts`:
  - `NEXT_PUBLIC_STELLAR_CONTRACT_ID` → `NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT`
  - `NEXT_PUBLIC_XLM_SAC_ID` → `NEXT_PUBLIC_XLM_SAC_CONTRACT`
  - Removed `NEXT_PUBLIC_STELLAR_NETWORK` (not read by code)
- **Consolidated** env var definitions:
  - Defined once at job level using `env:` block
  - Removed duplication across 3+ step-level `env:` blocks
- **Added** `env-check` job in `frontend.yml`:
  - Fails if workflow sets a `NEXT_PUBLIC_*` var not in `env.ts`
  - Runs on every PR to prevent drift

#### Benefits
- ✅ CI now exercises the actual contract IDs (secrets work correctly)
- ✅ No more copy-paste errors in env var names
- ✅ Automatic enforcement prevents future drift

#### Action Required
Repository secrets should be renamed or updated:
- `NEXT_PUBLIC_STELLAR_CONTRACT_ID` → `NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT`
- `NEXT_PUBLIC_XLM_SAC_ID` → `NEXT_PUBLIC_XLM_SAC_CONTRACT`
- `NEXT_PUBLIC_STELLAR_NETWORK` can be removed (unused)

---

### Issue #1453: Reconcile .env.example Files

#### What Changed
- **Root `.env.example`**:
  - Now a simple pointer to `Dechat/dex_with_fiat_frontend/.env.example`
  - Prevents two files getting out of sync
  
- **`Dechat/dex_with_fiat_frontend/.env.example`**:
  - Complete rewrite with comprehensive documentation
  - Lists **every** variable from `env.ts` schemas
  - Added missing variables:
    - `PAYSTACK_SECRET_KEY`, `PAYOUT_PROVIDER`, `ADMIN_API_TOKEN` (server-side)
    - `NEXT_PUBLIC_STELLAR_HORIZON_URL` (client-side, optional)
    - `ADMIN_SECRET`, `ADMIN_IP_ALLOWLIST`, `ADMIN_IP_ALLOWLIST_BYPASS_LOCAL`
    - Sentry config: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`
    - Feature flags: `NEXT_PUBLIC_FLAG_*`
  - Removed variables nothing reads:
    - `NEXT_PUBLIC_ADMIN_PUBLIC_KEY` (never referenced)
    - `NEXT_PUBLIC_STELLAR_CONTRACT_ID` (obsolete name)
    - `NEXT_PUBLIC_XLM_SAC_ID` (obsolete name)
    - `NEXT_PUBLIC_STELLAR_NETWORK` (never read)
  - Marked each variable as **(REQUIRED)**, **(OPTIONAL)**, or **(DEFAULT: value)**
  - Added clear CLIENT-SIDE vs SERVER-SIDE sections
  - Included security warnings for server-only vars

- **Added validation script** `scripts/validate-env-example.ts`:
  - Extracts variable names from `env.ts` schemas
  - Compares with `.env.example` keys
  - Fails if variables are missing or extra
  - Added `pnpm validate:env` script to `package.json`

#### Benefits
- ✅ Single source of truth for env vars
- ✅ All required variables documented with examples
- ✅ Automatic drift detection via validation script
- ✅ Clear guidance for developers

---

### Issue #1454: Fix Docker Configuration

#### What Changed

- **`docker-compose.yml`**:
  - Fixed build context: `./dex_with_fiat_frontend` → `./Dechat/dex_with_fiat_frontend`
  - Fixed volume mount: `./dex_with_fiat_frontend` → `./Dechat/dex_with_fiat_frontend`
  - Pinned stellar/quickstart image: `latest` → `testing`
  - Removed obsolete `version: '3.8'` key (deprecated in Compose V2)
  - Updated env var names to match `env.ts`:
    - `NEXT_PUBLIC_SOROBAN_RPC_URL` → `NEXT_PUBLIC_STELLAR_RPC_URL`
    - `NEXT_PUBLIC_HORIZON_URL` → `NEXT_PUBLIC_STELLAR_HORIZON_URL`
    - `NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT_ID` → `NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT`
    - Added `NEXT_PUBLIC_XLM_SAC_CONTRACT`
    - Removed unused vars: `NEXT_PUBLIC_ADMIN_ADDRESS`, `NEXT_PUBLIC_ENABLE_ADMIN_RECONCILIATION`
  - Removed `NEXT_PUBLIC_SOROBAN_NETWORK_PASSPHRASE` (not used)

- **`.env.docker`**:
  - Complete rewrite with correct variable names
  - Removed all obsolete variables
  - Added placeholders for required values
  - Added documentation comments

- **`Dechat/README.md`**:
  - Fixed docker setup command:
    ```bash
    # Old (broken):
    cp .env.docker dex_with_fiat_frontend/.env.local
    
    # New (correct):
    cp .env.docker Dechat/dex_with_fiat_frontend/.env.local
    ```

- **Added** `.github/workflows/docker-validate.yml`:
  - Validates `docker compose config` syntax
  - Checks for correct `Dechat/` paths
  - Verifies env var names match `env.ts`
  - Ensures `stellar/quickstart` image is pinned (not `latest`)
  - Verifies no obsolete `version:` key
  - Runs on every PR that touches Docker files

#### Benefits
- ✅ "Quick Start with Docker" instructions actually work
- ✅ Docker Compose uses correct paths after `Dechat/` restructure
- ✅ Environment variables match what the app reads
- ✅ Pinned image tag for reproducible builds
- ✅ CI prevents Docker config drift

---

## ✅ Acceptance Criteria Met

### Issue #1451
- [x] Deleted `frontend-build.yml`
- [x] Build once in `frontend.yml`, upload `.next/` artifact
- [x] E2E job downloads artifact (no rebuild)
- [x] Kept `paths:` filter for contract-only PR skip
- [x] Updated `auto-merge.yml` to remove "Frontend Build Check"

### Issue #1452
- [x] Replaced all obsolete variable names with correct ones
- [x] Defined env block once at job level
- [x] Added CI step that fails if workflow sets undeclared `NEXT_PUBLIC_*` vars
- [x] Documented required secret renames in PR

### Issue #1453
- [x] Root `.env.example` now points to `Dechat/` version
- [x] Listed every variable from `env.ts` schemas
- [x] Removed variables nothing reads
- [x] Marked required/optional and server/client scope
- [x] Added validation script (`scripts/validate-env-example.ts`)
- [x] Added `pnpm validate:env` to package.json

### Issue #1454
- [x] Fixed build context and volume paths to `Dechat/dex_with_fiat_frontend`
- [x] Renamed env vars to match `env.ts`
- [x] Pinned `stellar/quickstart:testing` image
- [x] Removed obsolete `version:` key
- [x] Fixed README copy command
- [x] Added CI job (`docker-validate.yml`) to catch path drift
- [x] Confirmed docker compose config is valid

---

## 🧪 Testing

### CI Workflows
```bash
# Validate workflow syntax
actionlint .github/workflows/frontend.yml
actionlint .github/workflows/docker-validate.yml

# Check env var names
grep -E "NEXT_PUBLIC_(STELLAR_CONTRACT_ID|XLM_SAC_ID|STELLAR_NETWORK)" .github/workflows/frontend.yml
# Should return no results ✅
```

### Environment Validation
```bash
cd Dechat/dex_with_fiat_frontend
pnpm validate:env
# ✅ SUCCESS: .env.example matches env.ts schema
```

### Docker Configuration
```bash
docker compose config > /dev/null
# ✅ docker-compose.yml is valid

# Verify paths
grep "Dechat/dex_with_fiat_frontend" docker-compose.yml
# ✅ Found correct paths

# Check for obsolete vars
grep -E "NEXT_PUBLIC_STELLAR_CONTRACT_ID|NEXT_PUBLIC_XLM_SAC_ID" docker-compose.yml .env.docker
# ✅ No obsolete variables
```

### ⚠️ Note on Test Failures

The CI may show 6 pre-existing test failures in:
- `src/components/__tests__/CCIPBridgeModal.test.tsx` (5 failures)
- `src/components/__tests__/SplitViewComparison.clipboard.test.tsx` (1 failure)

**These failures are NOT caused by this PR.** They exist on the main branch and are unrelated to CI/Docker/env configuration changes. The failures involve:
- Missing aria-labels that tests expect
- Text content split across multiple elements breaking `getByText` queries
- Clipboard copy button icon checks

Our changes only modified:
- Workflow files (`.github/workflows/`)
- Environment files (`.env.*`)
- Docker config (`docker-compose.yml`)
- Documentation (README, env examples)

None of these affect the CCIPBridgeModal or SplitViewComparison components.

---

## 📋 Migration Checklist for Maintainers

1. **Rename repository secrets** (Settings → Secrets and variables → Actions):
   - `NEXT_PUBLIC_STELLAR_CONTRACT_ID` → `NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT`
   - `NEXT_PUBLIC_XLM_SAC_ID` → `NEXT_PUBLIC_XLM_SAC_CONTRACT`
   - Delete `NEXT_PUBLIC_STELLAR_NETWORK` (unused)

2. **Verify CI passes** on this PR:
   - `Frontend CI` → `lint`, `build`, `e2e`, `env-check` jobs
   - `Docker Validate` → all validation checks pass

3. **After merge**, monitor auto-merge behavior:
   - Verify it no longer waits for "Frontend Build Check"
   - Should only wait for "Frontend CI", "Smart Contract CI", "Contract Tests"

---

## 🔧 Future Improvements

- Consider adding `tsx` to devDependencies for `validate:env` script
- Add pre-commit hook to run `pnpm validate:env`
- Add similar validation for `SENTRY_*` and `ADMIN_*` optional vars
- Document how to override env vars in local `.env.local` files

---

## 📚 Related Documentation

- [Environment Variables Guide](./Dechat/dex_with_fiat_frontend/.env.example)
- [Docker Setup Guide](./Dechat/README.md#quick-start-with-docker)
- [CI/CD Workflows](./.github/workflows/)

---

## 🙏 Credits

Fixes issues identified by maintainer review:
- #1451: CI inefficiency (3x builds per PR)
- #1452: Wrong env var names breaking CI secrets
- #1453: Drift between .env.example files and actual code
- #1454: Docker setup broken after Dechat/ restructure
