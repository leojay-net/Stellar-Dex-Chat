# Stellar-Dex-Chat

A decentralized exchange (DEX) interface prioritizing seamless asset-to-bank conversions leveraging AI-assisted conversations and automated Soroban smart contracts on the Stellar network.

## Overview

Stellar-Dex-Chat connects natural AI conversation flows with Stellar's fast blockchain technology to create an intuitive platform for cryptocurrency to fiat conversions. Users interact with an AI assistant that securely triggers smart contract interactions (utilizing Soroban) directly from the chat UI.

## Project Structure

```
Stellar-Dex-Chat/
├── Dechat/                    # Main application directory
│   ├── stellar-contracts/     # Soroban smart contracts (Rust)
│   ├── dex_with_fiat_frontend/ # Next.js 15 frontend application
│   └── README.md              # Detailed setup and architecture docs
├── docs/                      # Additional documentation
└── scripts/                   # Helper scripts
```

## Quick Start

For detailed installation instructions, architecture overview, and development setup, see the main documentation in [Dechat/README.md](Dechat/README.md).

### Prerequisites

- Node.js (v18 or higher)
- pnpm
- Rust & Cargo tooling with `wasm32-unknown-unknown` target
- Stellar CLI (for interacting with Soroban)
- Docker & Docker Compose (optional, for quick start).

### Fastest Start (Docker)

```bash
git clone https://github.com/leojay-net/Stellar-Dex-Chat.git
cd Stellar-Dex-Chat
cp .env.docker Dechat/dex_with_fiat_frontend/.env.local
docker compose up
```

The services will be available at:
- Frontend: http://localhost:3000
- Soroban RPC: http://localhost:8000/soroban/rpc
- Horizon API: http://localhost:8000

## Documentation

- [Main README](Dechat/README.md) - Complete setup guide, architecture, and development instructions
- [Environment Variable Reference](docs/environment.md) - Complete reference for frontend, server, Docker, and CI variables
- [Slippage Threshold](docs/slippage-threshold.md) - How slippage BPS and on-chain threshold interact
- [TypeScript SDK Examples](docs/typescript-sdk-examples.md) - Guide for calling contract functions

## Contributing

Contributions and feature reviews are welcome. Please open an issue to raise bugs or feature requests!

See [Dechat/README.md](Dechat/README.md#contributing) for repository conventions and PR guidelines.

## License

MIT

Enable declaration emission with stripInternal and point package.json "types" at dist/measurement.d.ts. The test-only
_resetSimulationHelperState helper is marked @internal, so it is left out of the published declarations but stays in the JavaScript.

tests/type-declarations.test.cjs packs the real tarball, installs it in an isolated consumer and compiles a strict TypeScript consumer against it. It also checks that API misuse and imports of stripped internals fail to compile.

Packaging docs are updated and the provenance manifest is regenerated. The Action bundles are unchanged.

What changed
Why
Testing Performed
Related Issue
Checklist
 I have read the CONTRIBUTING.md document.
 I have run npm run build and npm run bundle and committed the updated bundled/index.js if TypeScript code was changed.
 I have verified my changes against the dummy contract in contract/.
Closes #165
Closes #162
Closes #160
Closes #159

“Dove1010”
@claude
feat: ship TypeScript declarations for the package API 
ce0c40a
@drips-wave
drips-wave Bot
commented
14 minutes ago
@Dove1010 Great news! 🎉 Based on an automated assessment of this PR, the linked Wave issue(s) no longer count against your application limits.

You can now already apply to more issues while waiting for a review of this PR. Keep up the great work! 🚀

Learn more about application limits

@github-actions
github-actions Bot
commented
7 minutes ago
🟢 WeighIn Benchmark Report
Policy source: head weighin.toml at e580cd233beda097b18b39ba809ce863f646e620; content SHA256 49dc6428d4f7a271b185e8a2045be0dfa8074f483326d69ab1571a851f26d5dc.

All thresholds passed — comparing main → e580cd23

Contract path:weighin-fixtures.json / id:reference-contract
Runtime addresses: BASE CABH6BL4QLCTAC25TRDWRPC45TVDLRH5K6Q7DXDPE33AFYPUJBC7P47Y → HEAD CABH6BL4QLCTAC25TRDWRPC45TVDLRH5K6Q7DXDPE33AFYPUJBC7P47Y

hello / args:[{"type":"symbol","value":"world"}]
Compute source: soroban-simulation 28.0.1; protocol 28.

Metric	Base	Head	Delta	Change	Limit
⚪	CPU Instructions	266,842	266,842	±0	—	400,000,000
⚪	Memory Bytes	1,123,942	1,123,942	±0	—	41,943,040
⚪	Footprint Entries (RO + RW)	2	2	±0	—	400
⚪	Disk Read Bytes	0	0	±0	— (BASE 0)	200,000
⚪	Write Footprint Entries	0	0	±0	— (BASE 0)	200
⚪	Ledger Write Bytes	0	0	±0	— (BASE 0)	132,096
⚪	Historical Read Bytes	Unavailable	Unavailable	Unavailable	—	Unavailable
⚪	Contract Data (instance)	Unavailable	Unavailable	Unavailable	—	Unavailable

