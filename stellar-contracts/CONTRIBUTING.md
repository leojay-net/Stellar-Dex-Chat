# Contributing to Stellar-Dex-Chat Smart Contracts

Welcome! We appreciate your interest in contributing to the Stellar-Dex-Chat smart contracts. This guide will help you set up your local development environment, run tests, and submit pull requests.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Rust**: The primary language for Soroban smart contracts. [Install Rust](https://www.rust-lang.org/tools/install)
- **Soroban CLI**: Required for building and deploying contracts to the Stellar network. Follow the [Soroban documentation](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup) to install it.
- **Git**: For source control.

## Local Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/<your-username>/Stellar-Dex-Chat.git
   cd Stellar-Dex-Chat/stellar-contracts
   ```

2. Add the `wasm32-unknown-unknown` target for compiling contracts:
   ```bash
   rustup target add wasm32-unknown-unknown
   ```

3. Build the smart contracts to ensure your environment is set up correctly:
   ```bash
   cargo build --target wasm32-unknown-unknown --release
   ```

For more details on the architecture of our fiat bridge logic, please refer to [FIAT_BRIDGE_README.md](FIAT_BRIDGE_README.md) (if available).

## Running Tests

We maintain a strict testing suite to ensure the security and reliability of our smart contracts. 

To run the full test suite, navigate to the `stellar-contracts` directory and execute:
```bash
cargo test
```

To format code and check for warnings / common errors, run:
```bash
cargo fmt
cargo clippy --all-targets --all-features -- -D warnings
```
Ensure that all tests pass before opening a Pull Request. We run automated checks in our CI/CD pipeline, and PRs with failing tests will not be merged.

## Writing New Functions

When adding new functionality to the contracts, please follow these guidelines:

1. **Security First**: Consider edge cases, authorization limits, and potential overflows. Add thorough assertions.
2. **Error Handling**: Use the existing `Error` enum for custom failing states instead of panicking where applicable.
3. **Tests**: Every new feature or fix must be accompanied by relevant unit tests in `src/test.rs`. If you are fixing a bug, add a regression test.
4. **Soroban Documentation**: Be sure to refer to the official [Soroban Developer Docs](https://developers.stellar.org/docs/build/smart-contracts/overview) when implementing new network-specific behaviors.

## Submitting PRs

1. **Branching**: Create a new branch for your feature or bug fix:
   ```bash
   git checkout -b feature/my-new-feature
   ```
2. **Commit Messages**: Write clear, concise commit messages.
3. **Run CI Locally**: Do a final run of `cargo test` and `cargo clippy` to avoid simple CI failures.
4. **Push & PR**: Push to your fork and submit a Pull Request against our `main` branch. Provide a clear description of the problem your PR solves, and list any new tests added.

Thank you for contributing to the Stellar ecosystem!
