#!/bin/bash
set -e

# Default variables from environment or defaults
RPC_URL="${FUTURENET_RPC_URL:-https://rpc-futurenet.stellar.org}"
NETWORK_PASSPHRASE="${FUTURENET_NETWORK_PASSPHRASE:-Test SDF Future Network ; April 2020}"
SECRET_KEY="${FUTURENET_ADMIN_SECRET_KEY}"
WASM_PATH="${WASM_PATH:-target/wasm32-unknown-unknown/release/stellar_contracts.wasm}"
OUTPUT_FILE="${OUTPUT_FILE:-contract_id_futurenet.txt}"

if [ -z "$SECRET_KEY" ]; then
  echo "❌ FUTURENET_ADMIN_SECRET_KEY environment variable not configured."
  exit 1
fi

if [ ! -f "$WASM_PATH" ]; then
  echo "❌ WASM file not found at: $WASM_PATH"
  exit 1
fi

echo "🚀 Deploying FiatBridge to Futurenet..."

# Execute Soroban Deployment
# We capture the standard output/error to extract the Contract ID.
# On newer soroban-cli versions, successful deployment prints the ID natively,
# on older ones it may prefix it with 'Contract ID: '.
RAW_OUTPUT=$(soroban contract deploy \
  --wasm "$WASM_PATH" \
  --secret-key "$SECRET_KEY" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" 2>&1 || true)

# Extract 56-char Contract ID starting with 'C'
CONTRACT_ID=$(echo "$RAW_OUTPUT" | grep -oE "C[A-Z0-9]{55}" | head -n 1)

if [ -z "$CONTRACT_ID" ]; then
  echo "❌ Failed to deploy contract. Output was:"
  echo "$RAW_OUTPUT"
  exit 1
fi

echo "✅ Contract deployed successfully!"
echo "Contract ID: $CONTRACT_ID"
echo "$CONTRACT_ID" > "$OUTPUT_FILE"
