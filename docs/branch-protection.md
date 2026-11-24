# Branch protection on `main`

Closes #1455.

`main` currently has no branch protection
(`gh api repos/leojay-net/Stellar-Dex-Chat/branches/main/protection` returns
404). With nothing required, PRs can be merged with zero reviews and before
CI finishes — see the comment in `.github/workflows/auto-merge.yml` for the
full history of why that workflow exists as a workaround. This note records
the settings that should be applied instead, so they can be recreated if the
branch's protection is ever reset.

This file only documents the intended settings — applying them requires
`admin` access on `leojay-net/Stellar-Dex-Chat`, which a contributor PR from a
fork cannot grant itself. A maintainer needs to run this after the PR that
adds this doc (and the `CODEOWNERS` file it depends on) is merged.

## Settings to apply

- Require a pull request before merging.
- Require these status checks to pass before merging, and require branches to
  be up to date with `main` before merging:
  - `Check formatting` (Smart Contract CI)
  - `Run clippy` (Smart Contract CI)
  - `Run tests` (Smart Contract CI)
  - `Build WASM` (Smart Contract CI)
  - `Lint & Type Check` (Frontend CI)
  - `Build & Test` (Frontend CI)
  - `Lint Repo / lint` (repo-lint: conflict-marker + actionlint check)
- Require at least 1 approving review.
- Require review from Code Owners (see `/CODEOWNERS` — currently a single
  default owner; split by area once more maintainers are added).
- Block force pushes.
- Block branch deletion.

`Dechat/stellar-contracts`'s `License & Advisory Check` job and the new
weekly `security-audit.yml` workflow (see #1458) are deliberately **not**
required here — they gate dependency hygiene, not correctness, and shouldn't
block merges on a transient advisory-database update.

## Recreating these settings

```bash
gh api repos/leojay-net/Stellar-Dex-Chat/branches/main/protection \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  -f required_status_checks[strict]=true \
  -f 'required_status_checks[contexts][]=Check formatting' \
  -f 'required_status_checks[contexts][]=Run clippy' \
  -f 'required_status_checks[contexts][]=Run tests' \
  -f 'required_status_checks[contexts][]=Build WASM' \
  -f 'required_status_checks[contexts][]=Lint & Type Check' \
  -f 'required_status_checks[contexts][]=Build & Test' \
  -f 'required_status_checks[contexts][]=Lint Repo / lint' \
  -F enforce_admins=true \
  -f 'required_pull_request_reviews[required_approving_review_count]=1' \
  -F 'required_pull_request_reviews[require_code_owner_reviews]=true' \
  -F required_linear_history=false \
  -F allow_force_pushes=false \
  -F allow_deletions=false \
  -F restrictions=null
```

Verify afterwards with:

```bash
gh api repos/leojay-net/Stellar-Dex-Chat/branches/main/protection
```
