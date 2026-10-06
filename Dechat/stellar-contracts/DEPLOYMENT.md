# FiatBridge Futurenet Deployment Guide

This document describes how to deploy the FiatBridge smart contract to Stellar's Futurenet test network.

## Overview

The FiatBridge contract deployment process includes:
- **Atomic Deployment**: Deploy and initialize in one transaction to prevent front-running
- **Automated CI/CD**: GitHub Actions workflow for release branch deployments
- **Manual Deployment**: Local scripts for development and testing
- **Contract ID Management**: Automatic output of contract IDs for downstream integration

## ⚠️ Security: Front-Running Risk

**CRITICAL**: The FiatBridge contract's `init()` function accepts the admin address as a parameter and only checks `admin.require_auth()`. This means **anyone watching the ledger can call `init()` first with their own address as admin**.

Once initialized, the contract **cannot be re-initialized** (returns `AlreadyInitialized` error).

### The Attack Scenario

1. Attacker watches Futurenet ledger for new FiatBridge deployments
2. Legitimate deployer submits: `deploy CONTRACT`
3. Attacker immediately submits: `invoke CONTRACT init --admin ATTACKER_ADDRESS`
4. If attacker's transaction gets confirmed first, they become the admin
5. Legitimate deployer's `init()` call fails with `AlreadyInitialized`
6. Contract is permanently controlled by the attacker

### The Solution: Atomic Deployment

We prevent this by using `stellar contract deploy` with constructor arguments, which deploys and initializes **in a single transaction**:

```bash
stellar contract deploy \
    --wasm contract.wasm \
    --source deployer \
    --network futurenet \
    -- \
    --admin "$ADMIN_ADDRESS" \
    --token "$TOKEN_ADDRESS" \
    # ... other init params
```

This atomic operation ensures:
- ✅ Deploy and init happen in one transaction
- ✅ No window for front-running between deploy and init
- ✅ Admin is guaranteed to be the intended address
- ✅ Contract is production-ready immediately after deployment

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

### Bash Script (Atomic Deploy + Init)

```bash
# Set REQUIRED environment variables
export FUTURENET_ADMIN_SECRET_KEY="SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
export FUTURENET_ADMIN_ADDRESS="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
export FUTURENET_TOKEN_ADDRESS="CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
export FUTURENET_MULTISIG_SIGNERS="GAAAA...,GBBBB...,GCCCC..."  # Comma-separated
export FUTURENET_MULTISIG_THRESHOLD="2"

# Set OPTIONAL environment variables
export FUTURENET_RPC_URL="https://rpc-futurenet.stellar.org"
export OUTPUT_FILE="./contract_id_futurenet.txt"

# Run atomic deployment script
bash scripts/deploy_fiat_bridge_futurenet.sh
```

The script will:
1. ✅ Build the optimized WASM contract
2. ✅ Deploy and initialize **atomically** (prevents front-running)
3. ✅ Verify the admin address matches what you specified
4. ✅ Save the contract ID to file

### Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `FUTURENET_ADMIN_SECRET_KEY` | ✅ **Yes** | Admin Stellar secret key (S...) | None |
| `FUTURENET_ADMIN_ADDRESS` | ✅ **Yes** | Admin Stellar public key (G...) | None |
| `FUTURENET_TOKEN_ADDRESS` | ✅ **Yes** | Token contract address (C...) | None |
| `FUTURENET_MULTISIG_SIGNERS` | ✅ **Yes** | Comma-separated multisig public keys | None |
| `FUTURENET_MULTISIG_THRESHOLD` | ❌ No | Minimum signatures required | `2` |
| `FUTURENET_RPC_URL` | ❌ No | Futurenet RPC endpoint | `https://rpc-futurenet.stellar.org` |
| `FUTURENET_NETWORK_PASSPHRASE` | ❌ No | Futurenet network identifier | `Test SDF Future Network ; April 2020` |
| `OUTPUT_FILE` | ❌ No | Path to save contract ID | `./contract_id_futurenet.txt` |

### Dry Run Against Testnet

Before deploying to Futurenet, test the script against Testnet:

```bash
# Get Testnet credentials from https://lab.stellar.org/
export FUTURENET_ADMIN_SECRET_KEY="S..."  # Your testnet secret
export FUTURENET_ADMIN_ADDRESS="G..."     # Your testnet address
export FUTURENET_TOKEN_ADDRESS="C..."     # Testnet token contract
export FUTURENET_MULTISIG_SIGNERS="G...,G...,G..."
export FUTURENET_MULTISIG_THRESHOLD="2"

# Override to use Testnet
export FUTURENET_RPC_URL="https://soroban-testnet.stellar.org"
export FUTURENET_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Deploy to testnet
bash scripts/deploy_fiat_bridge_futurenet.sh
```

## Output

The deployment script will:
1. ✅ Build the optimized contract WASM
2. ✅ Deploy and initialize atomically (prevents front-running)
3. ✅ Verify the admin address matches expected value
4. ✅ Extract the contract ID
5. ✅ Save contract ID to the specified output file

**Example output:**
```
🚀 Deploying and initializing FiatBridge to Futurenet...
   RPC URL: https://rpc-futurenet.stellar.org
   Admin: GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   Token: CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   Multisig threshold: 2
   Output file: ./contract_id_futurenet.txt

🔑 Configuring identity...
📦 Building optimized WASM contract...
   WASM size: 98234 bytes

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

**Contract ID file (`contract_id_futurenet.txt`):**
```
CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456
```

## Automated CI/CD Deployment

### GitHub Actions Workflow

The deployment is automatically triggered on push to `release/*` branches or manually via `workflow_dispatch`.

**Workflow File:** `.github/workflows/deploy-futurenet.yml`

**Trigger Conditions:**
- Push to branches matching `release/**` pattern
- Only when `stellar-contracts/**` files change
- Manual trigger with `workflow_dispatch` (requires admin address input)

### Required Secrets

Configure the following secrets in GitHub repository settings (Settings → Secrets and variables → Actions):

| Secret Name | Description |
|-------------|-------------|
| `FUTURENET_ADMIN_SECRET_KEY` | Admin Stellar secret key (S...) |
| `FUTURENET_ADMIN_ADDRESS` | Admin Stellar public key (G...) |
| `FUTURENET_TOKEN_ADDRESS` | Token contract address (C...) |
| `FUTURENET_MULTISIG_SIGNERS` | Comma-separated multisig public keys |
| `FUTURENET_MULTISIG_THRESHOLD` | Minimum signatures required (default: 2) |

**Steps:**
1. Checkout code
2. Set up Rust toolchain with the `wasm32v1-none` target
3. Install Stellar CLI v28.0.0 (pinned, cached)
4. Build optimized WASM contract (`stellar contract build`)
5. Deploy and initialize atomically (prevents front-running)
6. Verify initialization (check admin address)
7. Upload contract ID artifact
8. Create deployment status with Stellar Expert link

### Setting Up GitHub Secrets

1. Go to **Repository Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Add each required secret:
   - `FUTURENET_ADMIN_SECRET_KEY`: Your Stellar secret key (S...)
   - `FUTURENET_ADMIN_ADDRESS`: Your Stellar public key (G...)
   - `FUTURENET_TOKEN_ADDRESS`: Token contract ID (C...)
   - `FUTURENET_MULTISIG_SIGNERS`: Comma-separated addresses (G...,G...,G...)
   - `FUTURENET_MULTISIG_THRESHOLD`: Number (e.g., `2`)
4. Click **Add secret** for each

### Monitoring Deployments

1. Go to **Actions** tab in your GitHub repository
2. Find the "Deploy FiatBridge to Futurenet" workflow
3. Click the deployment run to see logs and details
4. Artifacts are available for 90 days
5. Deployment status shows in the **Environments** page with Stellar Expert link

## Verifying Deployment

After deployment, verify the contract on Futurenet:

```bash
# Check the deployed contract's admin
stellar contract invoke \
  --id "CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456" \
  --network "futurenet" \
  --rpc-url "https://rpc-futurenet.stellar.org" \
  -- get_admin

# Check the contract's interface
stellar contract info interface \
  --contract-id "CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456" \
  --network "futurenet" \
  --rpc-url "https://rpc-futurenet.stellar.org"

# Inspect the contract's metadata (SDK / compiler versions)
stellar contract info meta \
  --contract-id "CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456" \
  --network "futurenet" \
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

### Issue: "Contract initialized with wrong admin"
**Cause:** This indicates a potential front-running attack where someone else called `init()` before you.

**Solution:** 
- The atomic deployment script should prevent this
- If using manual deployment, always use `stellar contract deploy -- --admin ...` with constructor args
- Never deploy and initialize in separate steps

### Issue: "AlreadyInitialized error"
**Cause:** Someone already called `init()` on this contract instance (possibly front-running).

**Solution:**
- Deploy a fresh contract instance (atomic deployment prevents this)
- Check who the current admin is: `stellar contract invoke --id CONTRACT_ID -- get_admin`
- If the admin is unexpected, you were front-run

## Security Considerations

### Secret Key Management

⚠️ **Important:** Never commit secret keys to the repository.

- Use GitHub Secrets for CI/CD deployments
- Store local secret keys in secure, encrypted storage
- Rotate keys periodically
- Use different keys for different environments (Futurenet, Testnet, Public)
- Never echo or log secret keys (the deployment script uses `stellar keys add` to avoid this)

### Front-Running Prevention

⚠️ **Critical:** Always use atomic deployment to prevent initialization front-running.

**Why this matters:**
- FiatBridge's `init()` function accepts admin address as a parameter
- Anyone can call `init()` if the contract is deployed but not initialized
- Once initialized, the contract cannot be re-initialized
- An attacker could become the admin and control the entire bridge

**How we prevent it:**
- ✅ Deploy with constructor args: `stellar contract deploy -- --admin ...`
- ✅ Verify admin after deployment: check `get_admin()` matches expected
- ✅ Deploy script fails if admin verification fails
- ❌ Never deploy and initialize in separate transactions

**What to do if you suspect front-running:**
1. Check the admin: `stellar contract invoke --id CONTRACT_ID -- get_admin`
2. If the admin is not your address, you were front-run
3. Deploy a new contract instance using atomic deployment
4. Report the incident (contract address, transaction ID, timeline)

## Additional Resources

- [Stellar smart contracts documentation](https://developers.stellar.org/docs/build/smart-contracts/overview)
- [Stellar CLI repository and reference](https://github.com/stellar/stellar-cli)
- [Futurenet Information](https://developers.stellar.org/networks/future-net)
- [Contract Deployment Guide](https://developers.stellar.org/learn/smart-contracts/deploy)
- [Stellar Expert (Contract Explorer)](https://stellar.expert/explorer/futurenet)
