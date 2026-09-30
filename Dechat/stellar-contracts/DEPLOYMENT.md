# FiatBridge Futurenet Deployment Guide

This document describes how to deploy the FiatBridge smart contract to Stellar's Futurenet test network.

## Overview

The FiatBridge contract deployment process includes:
- **Atomic Deployment & Initialization**: Deploy and initialize in a single transaction to prevent front-running
- **Automated CI/CD**: GitHub Actions workflow for release branch deployments
- **Manual Deployment**: Local scripts for development and testing
- **Contract ID Management**: Automatic output of contract IDs for downstream integration
- **Post-Deployment Verification**: Automated checks to ensure correct initialization

## ⚠️ Security: Front-Running Risk

**CRITICAL**: The FiatBridge contract's `init()` method only validates that the caller is authorized by the provided admin address (`admin.require_auth()`), but it does **not** verify that the admin address is the expected one. This means:

1. **The Problem**: If you deploy the contract and then call `init()` in a separate transaction, anyone watching the blockchain can call `init()` first with **their own address** as the admin.
2. **The Attack**: A malicious actor front-runs your `init()` call, gains admin control, and you cannot re-initialize (the contract checks `AlreadyInitialized`).
3. **The Solution**: Use atomic deployment — the `stellar contract deploy` command with constructor arguments deploys and initializes in a single transaction, making front-running impossible.

**This deployment script uses atomic deployment by default.** Do not split deploy and init into separate steps.
- **Atomic Initialization**: Deploy and init in one transaction to prevent front-running

## Security: Front-Running Risk

**⚠️ CRITICAL**: The FiatBridge `init()` function only checks `admin.require_auth()` for the admin address provided by the **caller**. This means:

1. Anyone watching the Futurenet ledger can see when a contract is deployed
2. They can immediately call `init()` with **their own address** as admin
3. Once initialized, the contract **cannot be re-initialized** (returns `AlreadyInitialized` error)
4. The attacker now controls admin functions (withdrawals, config changes, etc.)

**Solution**: This repo uses **atomic deployment** via `stellar contract deploy ... -- init ...`, which deploys the WASM and calls the constructor in a single transaction. No one else can call `init()` because the contract is already initialized when it hits the ledger.

## Prerequisites

### Required Tools
- **Rust** (1.93+): Install from [rustup.rs](https://rustup.rs/), then add the WASM
  target used by the current Soroban SDK:
  ```bash
  rustup target add wasm32v1-none
  ```
- **Stellar CLI** (`stellar`), pinned to a known release:
  ```bash
  cargo install --locked stellar-cli --version 28.0.0
  stellar --version
  ```

### Futurenet Setup
1. Create a Futurenet account at [Stellar Lab](https://lab.stellar.org/)
2. Fund your account with test lumens from the [Stellar Friendbot](https://laboratory.stellar.org/#friendbot-test-network)
3. Export your secret key securely

## Local Deployment

Before deploying, ensure you have completed all [Prerequisites](#prerequisites).

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `FUTURENET_ADMIN_SECRET_KEY` | Admin Stellar secret key (S...) | **Yes** | None |
| `FUTURENET_ADMIN_ADDRESS` | Admin Stellar public key (G...) | **Yes** | None |
| `FUTURENET_TOKEN_ADDRESS` | Token contract ID (C...) | **Yes** | None |
| `FUTURENET_MULTISIG_SIGNERS` | Comma-separated multisig public keys | **Yes** | None |
| `FUTURENET_MULTISIG_THRESHOLD` | Minimum signatures required | No | `2` |
| `FUTURENET_RPC_URL` | Futurenet RPC endpoint | No | `https://rpc-futurenet.stellar.org` |
| `FUTURENET_NETWORK_PASSPHRASE` | Futurenet network identifier | No | `Test SDF Future Network ; April 2020` |
| `OUTPUT_FILE` | Path to save contract ID | No | `./contract_id_futurenet.txt` |

### Example Deployment

```bash
# Set all required variables
export FUTURENET_ADMIN_SECRET_KEY="SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
export FUTURENET_ADMIN_ADDRESS="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
export FUTURENET_TOKEN_ADDRESS="CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
export FUTURENET_MULTISIG_SIGNERS="GXXXX...,GXXXX...,GXXXX..."
export FUTURENET_MULTISIG_THRESHOLD="2"

# Deploy and initialize atomically
cd Dechat/stellar-contracts
bash scripts/deploy_fiat_bridge_futurenet.sh
```

The script will:
1. ✅ Add the secret key to stellar CLI keyring (never echoed)
2. ✅ Build the optimized WASM contract
3. ✅ Deploy and initialize in a single atomic transaction
4. ✅ Verify the admin address matches expected value
5. ✅ Save contract ID to output file

### Dry Run Against Testnet

To test the deployment process without using Futurenet, you can deploy to Testnet first:

```bash
# Get testnet credentials
stellar keys generate testadmin --network testnet

# Fund the account
curl "https://friendbot.stellar.org?addr=$(stellar keys address testadmin)"

# Create a test token (or use an existing one)
export TEST_TOKEN="CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

# Set testnet environment variables
export FUTURENET_ADMIN_SECRET_KEY="$(stellar keys show testadmin --secret-key)"
export FUTURENET_ADMIN_ADDRESS="$(stellar keys address testadmin)"
export FUTURENET_TOKEN_ADDRESS="$TEST_TOKEN"
export FUTURENET_MULTISIG_SIGNERS="$(stellar keys address testadmin)"
export FUTURENET_MULTISIG_THRESHOLD="1"
export FUTURENET_RPC_URL="https://soroban-testnet.stellar.org"
export FUTURENET_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Run deployment
bash scripts/deploy_fiat_bridge_futurenet.sh
```

This allows you to verify the deployment script works correctly before deploying to Futurenet or Mainnet.

## Output

The deployment script produces:

```
🚀 Deploying and initializing FiatBridge to Futurenet...
   RPC URL: https://rpc-futurenet.stellar.org
   Admin: GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   Token: CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   Multisig threshold: 2
   Output file: ./contract_id_futurenet.txt

🔑 Configuring identity...
📦 Building optimized WASM contract...
   WASM size: 98432 bytes

⚙️  Deploying and initializing contract atomically...
   (This prevents front-running of the init call)

✅ Contract deployed and initialized successfully!
   Contract ID: CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456

🔍 Verifying initialization...
   Admin verified: GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
✅ Initialization verified!

📝 Contract ID saved to: ./contract_id_futurenet.txt

🎉 Deployment complete!

⚠️  SECURITY NOTE: This deployment used atomic init to prevent front-running.
   The contract was deployed and initialized in a single transaction.
   No one else can call init() on this contract instance.
```

**Output file (`contract_id_futurenet.txt`):**
```
CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456
```

## Automated CI/CD Deployment

### GitHub Actions Workflow

The deployment is automatically triggered on push to `release/*` branches.

**Workflow File:** `.github/workflows/deploy-futurenet.yml`

**Trigger Conditions:**
- Push to branches matching `release/**` pattern
- Only when `stellar-contracts/**` files change

**Required Secrets:**
Configure the following secrets in GitHub repository settings (Settings → Secrets and variables → Actions → Environments → futurenet):
- `FUTURENET_ADMIN_SECRET_KEY`: Admin secret key (S...)
- `FUTURENET_ADMIN_ADDRESS`: Admin public key (G...)
- `FUTURENET_TOKEN_ADDRESS`: Token contract ID (C...)
- `FUTURENET_MULTISIG_SIGNERS`: Comma-separated multisig public keys
- `FUTURENET_MULTISIG_THRESHOLD`: Minimum signatures (optional, defaults to 2)

**Manual Trigger:**
The workflow can be manually triggered via `workflow_dispatch` with custom parameters:
1. Go to **Actions** → **Deploy FiatBridge to Futurenet**
2. Click **Run workflow**
3. Enter admin address, token address, and threshold
4. Click **Run workflow**

**Steps:**
1. Checkout code
2. Set up Rust toolchain with the `wasm32v1-none` target
3. Install Stellar CLI (pinned version, cached)
4. Build optimized WASM contract (`stellar contract build`)
5. Deploy and initialize atomically (single transaction)
6. Verify admin address matches expected value
7. Upload contract ID artifact
8. Create deployment status with success/failure

### Setting Up GitHub Secrets

1. Go to **Repository Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Add `FUTURENET_ADMIN_SECRET_KEY` with your Stellar secret key
4. Click **Add secret**

### Monitoring Deployments

1. Go to **Actions** tab in your GitHub repository
2. Find the "Deploy FiatBridge to Futurenet" workflow
3. Click the deployment run to see logs and details
4. Artifacts are available for 90 days

## Verifying Deployment

After deployment, verify the contract on Futurenet:

```bash
# Check the deployed contract's interface.
stellar contract info interface \
  --contract-id "CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456" \
  --network "futurenet" \
  --network-passphrase "Test SDF Future Network ; April 2020" \
  --rpc-url "https://rpc-futurenet.stellar.org"

# Inspect the contract's metadata (SDK / compiler versions, custom entries).
stellar contract info meta \
  --contract-id "CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456" \
  --network "futurenet" \
  --network-passphrase "Test SDF Future Network ; April 2020" \
  --rpc-url "https://rpc-futurenet.stellar.org"
```

## Troubleshooting

### Issue: "FUTURENET_ADMIN_SECRET_KEY not set"
**Solution:** Ensure the environment variable is exported:
```bash
export FUTURENET_ADMIN_SECRET_KEY="your-secret-key"
```

### Issue: "Failed to deploy contract"
**Solution:** Check the following:
- RPC URL is accessible
- Admin account has sufficient lumens (minimum ~1 XLM)
- Secret key is valid
- Network passphrase matches Futurenet

### Issue: `stellar: command not found`
**Solution:** Install the pinned Stellar CLI release (see [Required Tools](#required-tools)):
```bash
cargo install --locked stellar-cli --version 28.0.0
stellar --version
```

### Issue: "Admin verification failed" after deployment
**Possible causes:**
1. **Front-running attack**: Someone else called `init()` before you (should be impossible with atomic deployment)
2. **Wrong admin address**: Check that `FUTURENET_ADMIN_ADDRESS` matches `FUTURENET_ADMIN_SECRET_KEY`
3. **Race condition**: Multiple deployments running simultaneously

**Solution:** This is a critical security issue. Do not use the deployed contract. Deploy a new instance with correct parameters.

### Issue: Cannot call init() - "AlreadyInitialized" error
**Cause:** The contract was already initialized by someone else (possibly a front-running attack).

**Solution:** This contract instance is compromised. You must deploy a new contract instance. The old instance cannot be re-initialized.

## Security Considerations

### Secret Management
⚠️ **Never commit secret keys to the repository.**

- Use GitHub Secrets for CI/CD deployments (environment-level for sensitive production keys)
- Store local secret keys in secure, encrypted storage (e.g., password manager, hardware wallet)
- Never echo or log secret keys in deployment scripts
- Rotate keys periodically
- Use different keys for different environments (Futurenet, Testnet, Mainnet)

### Atomic Deployment (Front-Running Prevention)
⚠️ **Always use atomic deployment with constructor initialization.**

The FiatBridge contract is vulnerable to initialization front-running. The `init()` method does not verify that the admin address provided matches an expected value—it only checks that the caller is authorized by that admin (`admin.require_auth()`).

**Attack scenario:**
1. You deploy the contract (no initialization)
2. You prepare to call `init()` with your admin address
3. Attacker watches the blockchain and sees your deployment
4. Attacker calls `init()` first with **their** address as admin
5. Your `init()` call fails with `AlreadyInitialized`
6. Attacker now controls the contract

**Prevention:**
- Use `stellar contract deploy --wasm <file> -- <constructor-args>` to deploy and initialize atomically
- The deployment script implements this by default
- Verify the admin address immediately after deployment
- Never split deploy and init into separate transactions

**If you suspect front-running:**
1. Check the contract's admin: `stellar contract invoke --id <contract-id> --network futurenet -- get_admin`
2. If the admin is not your address, the contract is compromised
3. Deploy a new instance (the compromised one cannot be re-initialized)
4. Investigate how the attacker obtained deployment information

## Additional Resources

- [Stellar smart contracts documentation](https://developers.stellar.org/docs/build/smart-contracts/overview)
- [Stellar CLI repository and reference](https://github.com/stellar/stellar-cli)
- [Futurenet Information](https://developers.stellar.org/networks/future-net)
- [Contract Deployment Guide](https://developers.stellar.org/learn/smart-contracts/deploy)
