# FiatBridge Futurenet Deployment Guide

This document describes how to deploy the FiatBridge smart contract to Stellar's Futurenet test network.

## Overview

The FiatBridge contract deployment process includes:
- **Automated CI/CD**: GitHub Actions workflow for release branch deployments
- **Manual Deployment**: Local scripts for development and testing
- **Contract ID Management**: Automatic output of contract IDs for downstream integration

## Prerequisites

### Required Tools
- **Rust** (1.70+): Install from [rustup.rs](https://rustup.rs/)
- **Soroban CLI**: Install using the provided script in the workflow or via:
  ```bash
  curl -s https://raw.githubusercontent.com/stellar/rs-soroban-sdk/master/soroban-env/install-soroban.sh | bash
  ```

### Futurenet Setup
1. Create a Futurenet account at [Stellar Lab](https://lab.stellar.org/)
2. Fund your account with test lumens from the [Stellar Friendbot](https://laboratory.stellar.org/#friendbot-test-network)
3. Export your secret key securely

## Local Deployment

### Option 1: Bash Script

```bash
# Set environment variables
export FUTURENET_ADMIN_SECRET_KEY="your-secret-key"
export FUTURENET_RPC_URL="https://rpc-futurenet.stellar.org"
export OUTPUT_FILE="./contract_id_futurenet.txt"

# Run deployment script
bash stellar-contracts/scripts/deploy_fiat_bridge_futurenet.sh
```

### Option 2: Rust Binary

```bash
# Set environment variables
export FUTURENET_ADMIN_SECRET_KEY="your-secret-key"

# Run the Rust deployment binary
cargo run --release --bin deploy_fiat_bridge_futurenet
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FUTURENET_ADMIN_SECRET_KEY` | **Required** - Admin Stellar secret key | None |
| `FUTURENET_RPC_URL` | Futurenet RPC endpoint | `https://rpc-futurenet.stellar.org` |
| `FUTURENET_NETWORK_PASSPHRASE` | Futurenet network identifier | `Test SDF Future Network ; April 2020` |
| `OUTPUT_FILE` | Path to save contract ID | `./contract_id_futurenet.txt` |

## Output

The deployment scripts will:
1. ✅ Build the contract to WASM
2. ✅ Deploy to Futurenet
3. ✅ Extract the contract ID
4. ✅ Save contract ID to the specified output file

**Example output file (`contract_id_futurenet.txt`):**
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
Configure the following secret in GitHub repository settings:
- `FUTURENET_ADMIN_SECRET_KEY`: Admin secret key for Futurenet

**Steps:**
1. Checkout code
2. Set up Rust toolchain with wasm32 target
3. Install Soroban CLI
4. Build WASM contract
5. Deploy to Futurenet
6. Upload contract ID artifact
7. Create deployment status

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
# Check contract info
soroban contract info \
  --contract "CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456" \
  --network "futurenet" \
  --rpc-url "https://rpc-futurenet.stellar.org"

# View contract instance
soroban contract instance \
  --contract "CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456" \
  --network "futurenet"
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

### Issue: Soroban CLI not found
**Solution:** Install Soroban CLI:
```bash
curl -s https://raw.githubusercontent.com/stellar/rs-soroban-sdk/master/soroban-env/install-soroban.sh | bash
export PATH="$HOME/.soroban/bin:$PATH"
```

## Security Considerations

⚠️ **Important:** Never commit secret keys to the repository.

- Use GitHub Secrets for CI/CD deployments
- Store local secret keys in secure, encrypted storage
- Rotate keys periodically
- Use different keys for different environments (Futurenet, Testnet, Public)

## Additional Resources

- [Stellar Soroban Documentation](https://developers.stellar.org/learn/fundamentals/stellar-data-structures)
- [Soroban CLI Reference](https://github.com/stellar/rs-soroban-sdk)
- [Futurenet Information](https://developers.stellar.org/networks/future-net)
- [Contract Deployment Guide](https://developers.stellar.org/learn/smart-contracts/deploy)
