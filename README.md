# DEX-CHAT - AI-Powered Asset to Fiat Bridge on Stellar

A decentralized exchange (DEX) interface prioritizing seamless asset-to-bank conversions leveraging AI-assisted conversations and automated Soroban smart contracts on the Stellar network.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-15.3.5-black)
![Rust](https://img.shields.io/badge/Rust-Soroban-orange)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)

## Overview

DEX-CHAT connects natural AI conversation flows with Stellar's fast blockchain technology to create an intuitive platform for cryptocurrency to fiat conversions. Users interact with an AI assistant that securely triggers smart contract interactions (utilizing Soroban) directly from the chat UI.

### Key Features

- **AI-Powered Interface**: Intelligent conversation flow with an AI assistant
- **Fiat Offramp**: Seamless conversions governed by Soroban smart contracts
- **Real Bank Integration**: Verification capabilities suited for fiat channels
- **Mobile-Responsive Design**: Optimized for all device sizes
- **Stellar Wallet Integration**: Connect via Freighter natively
- **Real-time Portfolio**: Live balance queries through the Stellar network

## Architecture

The project consists of two main components:

### 1. Smart Contracts (`/stellar-contracts`)
- **Blockchain**: Stellar (Soroban)
- **Main Contract**: `FiatBridge` - Secure logic governing asset deposits/withdrawals
- **Language**: Rust
- **Framework**: Soroban SDK

#### On-chain operational metrics (read-only)

The `FiatBridge` contract exposes read-only views intended for operational dashboards.

- `get_wq_depth() -> u64`
  Returns the current number of withdrawal requests present in the withdrawal request queue.

- `get_wq_oldest_queued_ledger() -> Option<u32>`
  Returns the ledger sequence when the oldest currently-pending withdrawal request was queued.
  Returns `None` when the queue is empty.

- `get_wq_oldest_age_ledgers() -> Option<u32>`
  Returns the age of the oldest currently-pending withdrawal request in units of ledgers, computed as:
  `current_ledger_sequence - oldest_queued_ledger`.
  Returns `None` when the queue is empty.

### 2. Frontend Application (`/dex_with_fiat_frontend`)
- **Framework**: Next.js 15 with TypeScript
- **Styling**: Tailwind CSS
- **Blockchain Integration**: `@stellar/stellar-sdk` and `@stellar/freighter-api`
- **Wallet Connection**: Freighter extension integration
- **AI Integration**: AI assistant API

## 🛠️ Technology Stack

### Frontend
- **Next.js 15.3.5** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Stellar SDK** - Core Stellar network interaction
- **Freighter API** - Web3 Stellar wallet integration
- **React Query** - State management

### Smart Contracts
- **Rust** - Smart contract implementation language
- **Soroban SDK** - Stellar's smart contract framework
- **Cargo** - Rust package manager

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher)
- **npm** or **yarn**
- **Rust** & Cargo tooling + `wasm32-unknown-unknown` target
- **Stellar CLI** (for interacting with Soroban)

## Installation & Setup

### 1. Clone the Repository

```bash
git clone https://github.com/leojay-net/DEX-CHAT.git
cd DEX-CHAT
```

### 2. Smart Contract Setup

```bash
cd stellar-contracts

# Build the smart contracts
cargo build --target wasm32-unknown-unknown --release

# Run tests
cargo test
```

### 3. Frontend Setup

```bash
cd dex_with_fiat_frontend

# Install dependencies needed for Stellar connection
npm install

# Start the development server
npm run dev
```

## Contributing
Contributions and feature reviews are welcome. Please open up an issue to raise bugs or feature requests!
