# Stellar Dex Chat: Admin Authentication Guide

This guide explains the architecture and security model of the Administrative Authentication system in the Stellar Dex Chat application.

## Overview

The administrative system is designed with a "Blockchain-First" philosophy. Unlike traditional web applications that rely on central databases or session cookies for role-based access control (RBAC), Stellar Dex Chat anchors administrative authority directly to the Stellar blockchain.

## Security Architecture

### 1. On-Chain Source of Truth
The definitive list of administrators and their privileges is stored within the `FiatBridge` smart contract on the Stellar network. 

### 2. Zero-Trust Frontend
The frontend does not store "is_admin" flags in local storage or cookies. Instead, every time an administrative route is accessed, the following flow occurs:
- The user's connected wallet address is retrieved via `useStellarWallet`.
- A real-time call is made to the smart contract's `get_admin` function (exposed as `getAdmin()` in the frontend library).
- The frontend compares the two addresses. Access is granted **only if they match exactly**.

### 3. Smart Contract Guards
Even if a malicious user bypasses the frontend UI checks, they cannot execute administrative actions. Every administrative function in the smart contract (e.g., `set_limit`, `pause`, `set_operator`) includes an internal `admin.require_auth()` check. This requires a valid cryptographic signature from the authorized admin address to succeed.

## Admin Roles & Permissions

| Action | Required Role | Function |
|--------|---------------|----------|
| Pause/Unpause | Admin | `pause()`, `unpause()` |
| Manage Operators | Admin | `set_operator()` |
| Set Asset Limits | Admin | `set_limit()` |
| Deny Addresses | Admin | `deny_address()` |
| Transfer Ownership| Admin | `transfer_admin()` |
| Emergency Recovery| Recovery Address | `emergency_recovery()` |

## Best Practices for Administrators

1. **Hardware Wallet**: Always use a hardware wallet (like Ledger) for the primary Admin address.
2. **Operator Role**: For day-to-day tasks like heartbeat signals, use the **Operator** role. Operators have restricted permissions and can be pruned by the Admin if compromised.
3. **Multisig Control**: The contract supports M-of-N multi-signature control for critical governance actions. Ensure the threshold is set to a value that balances security and availability (e.g., 3-of-5).

## Verification
You can verify the current admin at any time using a Stellar explorer (like StellarExpert) by querying the `FiatBridge` contract instance storage for the `Admin` key.
