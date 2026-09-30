#!/bin/bash

# DeployFiatBridgeFuturenet Script
# Deploys and initializes the FiatBridge contract atomically to Futurenet.
# Atomic deployment prevents front-running of the init() call.
#
# Environment variables:
#   REQUIRED:
#   - FUTURENET_ADMIN_SECRET_KEY: Admin private key (S...)
#   - FUTURENET_ADMIN_ADDRESS: Admin public key (G...)
#   - FUTURENET_TOKEN_ADDRESS: Token contract ID (C...)
#   - FUTURENET_MULTISIG_SIGNERS: Comma-separated multisig public keys
#   - FUTURENET_MULTISIG_THRESHOLD: Minimum signatures required
#
#   OPTIONAL:
#   - FUTURENET_RPC_URL: Futurenet RPC endpoint
#   - FUTURENET_NETWORK_PASSPHRASE: Futurenet passphrase
#   - OUTPUT_FILE: File path for contract ID output

set -euo pipefail

# Configuration with defaults
RPC_URL="${FUTURENET_RPC_URL:-https://rpc-futurenet.stellar.org}"
NETWORK_PASSPHRASE="${FUTURENET_NETWORK_PASSPHRASE:-Test SDF Future Network ; April 2020}"
OUTPUT_FILE="${OUTPUT_FILE:-./contract_id_futurenet.txt}"

# Required variables
ADMIN_SECRET_KEY="${FUTURENET_ADMIN_SECRET_KEY:-}"
ADMIN_ADDRESS="${FUTURENET_ADMIN_ADDRESS:-}"
TOKEN_ADDRESS="${FUTURENET_TOKEN_ADDRESS:-}"
MULTISIG_SIGNERS="${FUTURENET_MULTISIG_SIGNERS:-}"
MULTISIG_THRESHOLD="${FUTURENET_MULTISIG_THRESHOLD:-2}"

# Validate required environment variables
if [ -z "$ADMIN_SECRET_KEY" ]; then
    echo "❌ Error: FUTURENET_ADMIN_SECRET_KEY environment variable is not set"
    exit 1
fi

if [ -z "$ADMIN_ADDRESS" ]; then
    echo "❌ Error: FUTURENET_ADMIN_ADDRESS environment variable is not set"
    exit 1
fi

if [ -z "$TOKEN_ADDRESS" ]; then
    echo "❌ Error: FUTURENET_TOKEN_ADDRESS environment variable is not set"
    exit 1
fi

if [ -z "$MULTISIG_SIGNERS" ]; then
    echo "❌ Error: FUTURENET_MULTISIG_SIGNERS environment variable is not set"
    exit 1
fi

echo "🚀 Deploying and initializing FiatBridge to Futurenet..."
echo "   RPC URL: $RPC_URL"
echo "   Admin: $ADMIN_ADDRESS"
echo "   Token: $TOKEN_ADDRESS"
echo "   Multisig threshold: $MULTISIG_THRESHOLD"
echo "   Output file: $OUTPUT_FILE"
echo ""

# Add secret key to stellar CLI keyring (never echo the secret)
echo "🔑 Configuring identity..."
stellar keys add deployer --secret-key "$ADMIN_SECRET_KEY" 2>/dev/null || true

# Build the optimized contract
echo "📦 Building optimized WASM contract..."
stellar contract build

WASM_FILE="./target/wasm32v1-none/release/stellar_contracts.optimized.wasm"

if [ ! -f "$WASM_FILE" ]; then
    echo "❌ Error: Optimized WASM file not found at $WASM_FILE"
    echo "   stellar contract build should produce .optimized.wasm"
    exit 1
fi

WASM_SIZE=$(wc -c < "$WASM_FILE" | tr -d '[:space:]')
echo "   WASM size: $WASM_SIZE bytes"
echo ""

# Parse multisig signers into array for constructor args
IFS=',' read -ra SIGNER_ARRAY <<< "$MULTISIG_SIGNERS"

# Deploy and initialize atomically using stellar contract deploy with constructor
# This prevents anyone else from calling init() before us (front-running)
echo "⚙️  Deploying and initializing contract atomically..."
echo "   (This prevents front-running of the init call)"
echo ""

# Build the deploy command with constructor args
# FiatBridge::init signature:
#   fn init(env: Env, admin: Address, token: Address, 
#           per_token_deposit_limit: i128, daily_deposit_limit: i128,
#           per_token_withdrawal_limit: i128, daily_withdrawal_limit: i128,
#           multisig_signers: Vec<Address>, multisig_threshold: u32)

DEPLOY_OUTPUT=$(stellar contract deploy \
    --wasm "$WASM_FILE" \
    --source deployer \
    --network futurenet \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- \
    --admin "$ADMIN_ADDRESS" \
    --token "$TOKEN_ADDRESS" \
    --per-token-deposit-limit 1000000000000 \
    --daily-deposit-limit 10000000000000 \
    --per-token-withdrawal-limit 1000000000000 \
    --daily-withdrawal-limit 10000000000000 \
    --multisig-signers "$(printf '%s,' "${SIGNER_ARRAY[@]}" | sed 's/,$//')" \
    --multisig-threshold "$MULTISIG_THRESHOLD" \
    2>&1)

# Extract contract ID from output
# stellar contract deploy prints just the contract ID on success
CONTRACT_ID=$(echo "$DEPLOY_OUTPUT" | grep -E '^C[A-Z0-9]{55}$' | head -1)

if [ -z "$CONTRACT_ID" ]; then
    echo "❌ Error: Failed to deploy and initialize contract"
    echo ""
    echo "Deploy output:"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi

echo "✅ Contract deployed and initialized successfully!"
echo "   Contract ID: $CONTRACT_ID"
echo ""

# Verify initialization by calling get_admin
echo "🔍 Verifying initialization..."
ACTUAL_ADMIN=$(stellar contract invoke \
    --id "$CONTRACT_ID" \
    --network futurenet \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- get_admin 2>&1 | tr -d '"')

if [ "$ACTUAL_ADMIN" != "$ADMIN_ADDRESS" ]; then
    echo "❌ Error: Admin verification failed!"
    echo "   Expected: $ADMIN_ADDRESS"
    echo "   Actual: $ACTUAL_ADMIN"
    exit 1
fi

echo "   Admin verified: $ACTUAL_ADMIN"
echo "✅ Initialization verified!"
echo ""

# Output contract ID to file for downstream scripts
mkdir -p "$(dirname "$OUTPUT_FILE")"
echo "$CONTRACT_ID" > "$OUTPUT_FILE"
echo "📝 Contract ID saved to: $OUTPUT_FILE"

# Also set as GitHub Actions output if running in CI
if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "contract_id=$CONTRACT_ID" >> "$GITHUB_OUTPUT"
fi

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "⚠️  SECURITY NOTE: This deployment used atomic init to prevent front-running."
echo "   The contract was deployed and initialized in a single transaction."
echo "   No one else can call init() on this contract instance."
