#!/bin/bash

# DeployFiatBridgeFuturenet Script
# Deploys the FiatBridge contract to Futurenet and outputs the contract ID
# Environment variables:
#   - FUTURENET_ADMIN_SECRET_KEY: Admin private key for Futurenet
#   - FUTURENET_RPC_URL: Futurenet RPC endpoint (default: https://rpc-futurenet.stellar.org)
#   - FUTURENET_NETWORK_PASSPHRASE: Futurenet passphrase (default: Test SDF Future Network)
#   - OUTPUT_FILE: File path for contract ID output (default: ./contract_id_futurenet.txt)

set -e

# Configuration with defaults
RPC_URL="${FUTURENET_RPC_URL:-https://rpc-futurenet.stellar.org}"
NETWORK_PASSPHRASE="${FUTURENET_NETWORK_PASSPHRASE:-Test SDF Future Network ; April 2020}"
OUTPUT_FILE="${OUTPUT_FILE:-./contract_id_futurenet.txt}"
ADMIN_SECRET_KEY="${FUTURENET_ADMIN_SECRET_KEY}"

# Validate required environment variable
if [ -z "$ADMIN_SECRET_KEY" ]; then
    echo "❌ Error: FUTURENET_ADMIN_SECRET_KEY environment variable is not set"
    exit 1
fi

echo "🚀 Deploying FiatBridge to Futurenet..."
echo "   RPC URL: $RPC_URL"
echo "   Output file: $OUTPUT_FILE"

# Build the contract
echo "📦 Building WASM contract..."
cargo build --target wasm32-unknown-unknown --release

WASM_FILE="./target/wasm32-unknown-unknown/release/stellar_contracts.wasm"

if [ ! -f "$WASM_FILE" ]; then
    echo "❌ Error: WASM file not found at $WASM_FILE"
    exit 1
fi

# Get the account ID from the secret key
echo "🔑 Deriving account ID from secret key..."
# Note: This uses soroban CLI - ensure it's installed and configured
ACCOUNT_ID=$(soroban keys show --secret-key "$ADMIN_SECRET_KEY" 2>/dev/null || echo "")

if [ -z "$ACCOUNT_ID" ]; then
    echo "⚠️  Could not derive account ID. Using soroban directly with key..."
    # Soroban will use the key directly
fi

# Deploy the contract
echo "⚙️  Deploying contract to Futurenet..."
CONTRACT_ID=$(soroban contract deploy \
    --wasm "$WASM_FILE" \
    --source-account "$ACCOUNT_ID" \
    --secret-key "$ADMIN_SECRET_KEY" \
    --network "futurenet" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    2>&1 | grep -oP "Contract ID: \K[A-Z0-9]+" || true)

if [ -z "$CONTRACT_ID" ]; then
    echo "❌ Error: Failed to deploy contract or extract contract ID"
    echo "   Check RPC URL and credentials"
    exit 1
fi

echo "✅ Contract deployed successfully!"
echo "   Contract ID: $CONTRACT_ID"

# Output contract ID to file for downstream scripts
mkdir -p "$(dirname "$OUTPUT_FILE")"
echo "$CONTRACT_ID" > "$OUTPUT_FILE"
echo "📝 Contract ID saved to: $OUTPUT_FILE"

# Also set as GitHub Actions output if running in CI
if [ -n "$GITHUB_OUTPUT" ]; then
    echo "contract_id=$CONTRACT_ID" >> "$GITHUB_OUTPUT"
fi

echo "🎉 Deployment complete!"
