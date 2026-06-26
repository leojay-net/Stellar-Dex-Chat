# Contributing

## Branch Naming

Branches follow this pattern:
<your-username>/<type>/<short-description>

`<type>` is one of:

- `feat/` — new feature
- `fix/` — bug fix
- `chore/` — maintenance, tooling, dependencies
- `docs/` — documentation only
- `refactor/` — code change that isn't a fix or a feature
- `test/` — adding or fixing tests

If your branch addresses one or more issues, include the issue number(s) in the description:
feat/issues-986-987-988-frontend-accessibility

fix/issue-966-fee-calculation-overflow

## Commit Message Format

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):
<type>(<scope>): <description>

`<type>` must be one of:

- `feat` — new feature
- `fix` — bug fix
- `docs` — documentation only
- `style` — formatting, no code meaning change
- `refactor` — code change that isn't a fix or a feature
- `perf` — performance improvement
- `test` — adding or fixing tests
- `build` — build system or dependencies
- `ci` — CI configuration
- `chore` — anything else maintenance-related
- `security` — security fix

`<scope>` is optional and usually the area touched, e.g. `frontend`, `contract`.

Reference issue numbers in the description when relevant:
feat(frontend): add CSV export button to AuditTable

fix(contract): integer overflow in fee calculation for large deposits #966

docs: add CONTRIBUTING.md with branch and commit conventions

A breaking change is marked with `!` after the type/scope:
feat(contract)!: change withdrawal function signature

## Pull Request Checklist

Before opening a PR:

- [ ] Branch name follows the format above
- [ ] Commit messages follow the format above
- [ ] PR description links the issue(s) it closes (`Closes #123`)
- [ ] `npx lint-staged` runs clean (this also runs automatically on commit)
- [ ] Tests pass locally
- [ ] No unrelated files included in the diff
