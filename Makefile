# Keep the validation targets below aligned with frontend.yml and contracts.yml.
# CI calls these same targets. GitHub-specific reporting stays in the workflows.
# Use Node 24 and the pnpm version in the frontend package.json. Install the
# frontend dependencies and Playwright browsers before running make ci.
# Contracts require stable Rust, rustfmt, clippy, wasm32v1-none, Stellar CLI
# 28.0.0 and cargo-deny 0.20.2 (the version in the contract CI action).
FRONTEND := Dechat/dex_with_fiat_frontend
CONTRACTS := Dechat/stellar-contracts
PNPM := pnpm --dir $(FRONTEND)
WASM := $(CONTRACTS)/target/wasm32v1-none/release/stellar_contracts.wasm
MAX_WASM_BYTES ?= 125000

.PHONY: ci frontend-check frontend-typecheck frontend-lint frontend-build frontend-test \
	frontend-coverage-merge frontend-e2e-build frontend-e2e contracts-fmt \
	contracts-test contracts-clippy contracts-build contracts-size contracts-deny

.NOTPARALLEL: ci
ci: frontend-check frontend-typecheck frontend-lint frontend-build frontend-test \
	frontend-e2e-build frontend-e2e contracts-fmt contracts-test contracts-clippy \
	contracts-build contracts-size contracts-deny

frontend-check:
	$(PNPM) check

frontend-typecheck:
	$(PNPM) typecheck

frontend-lint:
	$(PNPM) lint

frontend-build:
	$(PNPM) build

frontend-test:
	NODE_OPTIONS=--max-old-space-size=8192 $(if $(SHARD),VITEST_COVERAGE_SHARD=true) $(PNPM) test:coverage \
		$(if $(SHARD),--reporter=blob --reporter=dot --coverage.reporter=json-summary --shard=$(SHARD)) \
		$(if $(JUNIT_REPORT),--reporter=junit --outputFile.junit="$(JUNIT_REPORT)")

frontend-coverage-merge:
	NODE_OPTIONS=--max-old-space-size=4096 $(PNPM) test:coverage:merge

frontend-e2e-build:
	NEXT_PUBLIC_E2E=true $(PNPM) build

frontend-e2e:
	CI=true $(PNPM) test:e2e

contracts-fmt:
	cd $(CONTRACTS) && cargo fmt --all -- --check

contracts-test:
	cd $(CONTRACTS) && cargo test

contracts-clippy:
	cd $(CONTRACTS) && cargo clippy --all-targets --all-features -- -D warnings

contracts-build:
	cd $(CONTRACTS) && stellar contract build

contracts-size:
	@size=$$(wc -c < "$(WASM)") && \
		echo "Contract WASM size: $$size bytes (limit $(MAX_WASM_BYTES))" && \
		test "$$size" -le "$(MAX_WASM_BYTES)"

contracts-deny:
	cargo deny --manifest-path $(CONTRACTS)/Cargo.toml check licenses advisories bans sources
