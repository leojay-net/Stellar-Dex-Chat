.PHONY: ci frontend-typecheck frontend-lint frontend-build frontend-test frontend-e2e contracts-test

# Reproduces the validation matrix used by the pull-request workflows.
ci: frontend-typecheck frontend-lint frontend-build frontend-test frontend-e2e contracts-test

frontend-typecheck:
	pnpm --dir Dechat/dex_with_fiat_frontend typecheck

frontend-lint:
	pnpm --dir Dechat/dex_with_fiat_frontend lint

frontend-build:
	pnpm --dir Dechat/dex_with_fiat_frontend build

frontend-test:
	pnpm --dir Dechat/dex_with_fiat_frontend test:coverage

frontend-e2e:
	pnpm --dir Dechat/dex_with_fiat_frontend test:e2e

contracts-test:
	cargo test --manifest-path Dechat/stellar-contracts/Cargo.toml
	cargo build --manifest-path Dechat/stellar-contracts/Cargo.toml --target wasm32-unknown-unknown --release
	cargo clippy --manifest-path Dechat/stellar-contracts/Cargo.toml --all-targets --all-features -- -D warnings
