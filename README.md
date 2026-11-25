# Stellar-Dex-Chat



A decentralized exchange (DEX) interface prioritizing seamless asset-to-bank conversions leveraging AI-assisted conversations and automated Soroban smart contracts on the Stellar network.

## Quick Start

For detailed installation instructions, architecture overview, and development setup, see the main documentation in [Dechat/README.md](Dechat/README.md)

### Fastest Start (Docker)

```bash
git clone https://github.com/leojay-net/Stellar-Dex-Chat.git
cd Stellar-Dex-Chat
cp .env.docker Dechat/dex_with_fiat_frontend/.env.local
docker compose up
```

The services will be available at:
- Frontend: http://localhost:3000
- Soroban RPC: http://localhost:8000/rpc
- Horizon API: http://localhost:8000

## Documentation

- [Main README](Dechat/README.md) - Complete setup guide, architecture, and development instructions
- [Testing Guide](docs/testing.md) - Primary entry point for unit, E2E, and contract testing
- [Production Frontend Deployment](docs/deployment-frontend.md) - Deploying the Next.js frontend to production
- [Glossary](docs/glossary.md) - Definitions for Stellar-Dex-Chat terminology used in contracts, frontend, and docs
- [Environment Variable Reference](docs/environment.md) - Complete reference for frontend, server, Docker, and CI variables
- [Accessibility Conformance Checklist](docs/accessibility.md) - WCAG 2.2 AA target specifications, reviewer checklists, and gap analysis
- [ADR-003: Offline Message Queue & IndexedDB](docs/adr/ADR-003-offline-message-queue.md) - Architectural decision record for client-side offline queue and storage
- [FiatBridge Contract Function Reference](Dechat/stellar-contracts/docs/REFERENCE.md) - Complete function reference for all 142 Soroban contract functions
- [Slippage Threshold](docs/slippage-threshold.md) - How slippage BPS and on-chain threshold interact
- [TypeScript SDK Examples](docs/typescript-sdk-examples.md) - Guide for calling contract functions

## Contributing

Contributions and feature reviews are welcome. Please open an issue to raise bugs or feature requests!

See [Dechat/README.md](Dechat/README.md#contributing) for repository conventions and PR guidelines.

## License

MIT
