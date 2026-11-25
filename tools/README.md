# tools/

One-shot maintenance scripts used during the initial project setup. They are
kept for reference but are **not part of the CI pipeline** and do not need to be
run again under normal development.

---

## Scripts

### `create_50_issues.py`

Seeds 50 GitHub issues in the `leojay-net/Stellar-Dex-Chat` repository covering
smart-contract features, frontend tasks, testing, and documentation. Run once at
project bootstrap to populate the issue tracker.

**Hard-coded target repo:** `leojay-net/Stellar-Dex-Chat`

```bash
python3 tools/create_50_issues.py
```

Requires the `gh` CLI to be authenticated as a maintainer of the target repo.

---

### `create_advanced_contract_issues.py`

Seeds a second batch of issues focused on advanced smart-contract topics (oracle
integration, event schemas, per-token rate limits, etc.).

**Hard-coded target repo:** `leojay-net/Stellar-Dex-Chat`

```bash
python3 tools/create_advanced_contract_issues.py
```

---

### `create_wave_feature_issues.py`

Seeds Wave-programme feature issues (network-mismatch warnings, offline queue
UI, CSP hardening, etc.).

**Hard-coded target repo:** `leojay-net/Stellar-Dex-Chat`

```bash
python3 tools/create_wave_feature_issues.py
```

---

### `fix_test_memo_hash.py`

A one-time local patch that rewrites deprecated `memo_hash` call sites in
`stellar-contracts/src/test.rs` to match the updated SDK interface. The patch
has already been applied; this script is retained for audit purposes and should
**not** be run again.

**Hard-coded local path:** `/Users/mac/Desktop/CODE/stellar-dex-chat/...`
(differs from the standard clone path — do not run without editing the path
constant at the top of the file).

---

## Notes

- All scripts use the `gh` CLI (`subprocess.run(['gh', ...])`) and assume it is
  authenticated.
- The repo slug is hard-coded in each file. Fork users must update `REPO` before
  running.
- None of these scripts are imported by application code; removing them will not
  affect the build or tests.
