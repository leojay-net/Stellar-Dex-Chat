# Project guidance

## Commit messages

Do **not** add `Co-Authored-By:` trailers to commits. In particular, never add
`Co-Authored-By: Claude <noreply@anthropic.com>` or any other AI-assistant
attribution. Commits should carry only their human author.

This applies to every commit, amend, rebase, squash, and merge made in this
repository. A `commit-msg` hook (`.husky/commit-msg`) strips AI-assistant
trailers as a backstop, but they should not be written in the first place.

Human `Co-Authored-By:` trailers added deliberately by contributors for real
pair programming are fine and must not be removed.

## Layout

The application lives under `Dechat/`:


- `Dechat/stellar-contracts` — Soroban smart contracts (Rust)
- `Dechat/dex_with_fiat_frontend` — Next.js frontend

CI workflow path filters point at these directories. The stray top-level
`stellar-contracts/` and `dex_with_fiat_frontend/` directories are leftovers
from the rebrand move and hold no source.

## Checks that must pass

Contracts (`Dechat/stellar-contracts`):

```
cargo test
cargo clippy --all-targets --all-features -- -D warnings
cargo build --target wasm32-unknown-unknown --release   # WASM must stay under 55 KB
```

Frontend (`Dechat/dex_with_fiat_frontend`):

```
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```
