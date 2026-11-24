#!/bin/bash

# deploy_fiat_bridge_testnet.sh
# Deploys and initializes the FiatBridge contract to Stellar Testnet.
# Parametrised via environment variables; supports --dry-run mode.
#
# Usage:
#   TESTNET_ADMIN_SECRET_KEY=S... \
#   TESTNET_ADMIN_ADDRESS=G... \
#   TESTNET_TOKEN_ADDRESS=C... \
#   TESTNET_MULTISIG_SIGNERS=G1...,G2... \
#   ./scripts/deploy_fiat_bridge_testnet.sh [--dry-run]
#
# Optional env vars:
#   TESTNET_RPC_URL             (default: https://soroban-testnet.stellar.org)
#   TESTNET_NETWORK_PASSPHRASE  (default: Test SDF Network ; September 2015)
#   WASM_PATH                   (default: auto-detected optimized build)
#   TESTNET_MULTISIG_THRESHOLD  (default: 2)
#   DEPLOYMENT_RECORD_DIR       (default: ./deployments)

set -euo pipefail

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# ── Configuration ─────────────────────────────────────────────────────────────
NETWORK="testnet"
RPC_URL="${TESTNET_RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${TESTNET_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
MULTISIG_THRESHOLD="${TESTNET_MULTISIG_THRESHOLD:-2}"
DEPLOYMENT_RECORD_DIR="${DEPLOYMENT_RECORD_DIR:-./deployments}"

ADMIN_SECRET_KEY="${TESTNET_ADMIN_SECRET_KEY:-}"
ADMIN_ADDRESS="${TESTNET_ADMIN_ADDRESS:-}"
TOKEN_ADDRESS="${TESTNET_TOKEN_ADDRESS:-}"
MULTISIG_SIGNERS="${TESTNET_MULTISIG_SIGNERS:-}"

# ── Validate required env vars ────────────────────────────────────────────────
for var in ADMIN_SECRET_KEY ADMIN_ADDRESS TOKEN_ADDRESS MULTISIG_SIGNERS; do
  if [ -z "${!var}" ]; then
    echo "❌ Error: TESTNET_${var} is not set"
    exit 1
  fi
done

# ── Resolve WASM ──────────────────────────────────────────────────────────────
WASM_PATH="${WASM_PATH:-./target/wasm32v1-none/release/stellar_contracts.optimized.wasm}"

echo "============================================================"
echo "  FiatBridge → Testnet deployment"
echo "============================================================"
echo "  RPC URL   : $RPC_URL"
echo "  Admin     : $ADMIN_ADDRESS"
echo "  Token     : $TOKEN_ADDRESS"
echo "  Threshold : $MULTISIG_THRESHOLD"
echo "  WASM      : $WASM_PATH"
echo "  Dry run   : $DRY_RUN"
echo "============================================================"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "🔍 DRY RUN — validating inputs without submitting any transaction."
  echo ""
fi

# ── Build ─────────────────────────────────────────────────────────────────────
if [ ! -f "$WASM_PATH" ]; then
  echo "📦 Optimized WASM not found — building now..."
  stellar contract build
fi

if [ ! -f "$WASM_PATH" ]; then
  echo "❌ Error: WASM not found at $WASM_PATH after build"
  exit 1
fi

WASM_SIZE=$(wc -c < "$WASM_PATH" | tr -d '[:space:]')
WASM_HASH=$(sha256sum "$WASM_PATH" | awk '{print $1}')
echo "   WASM size : $WASM_SIZE bytes"
echo "   WASM sha256: $WASM_HASH"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "✅ Dry run complete — WASM exists and all required env vars are set."
  echo "   Re-run without --dry-run to submit the deployment transaction."
  exit 0
fi

# ── Add identity ──────────────────────────────────────────────────────────────
echo "🔑 Configuring identity..."
stellar keys add deployer --secret-key "$ADMIN_SECRET_KEY" 2>/dev/null || true

# ── Deploy + init atomically ──────────────────────────────────────────────────
IFS=',' read -ra SIGNER_ARRAY <<< "$MULTISIG_SIGNERS"

echo "⚙️  Deploying and initializing contract atomically..."
DEPLOY_OUTPUT=$(stellar contract deploy \
    --wasm "$WASM_PATH" \
    --source deployer \
    --network "$NETWORK" \
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

CONTRACT_ID=$(echo "$DEPLOY_OUTPUT" | grep -E '^C[A-Z0-9]{55}$' | head -1)

if [ -z "$CONTRACT_ID" ]; then
  echo "❌ Deployment failed"
  echo "$DEPLOY_OUTPUT"
  exit 1
fi

echo "✅ Contract deployed: $CONTRACT_ID"
echo ""

# ── Verify ────────────────────────────────────────────────────────────────────
echo "🔍 Verifying initialization..."
ACTUAL_ADMIN=$(stellar contract invoke \
    --id "$CONTRACT_ID" \
    --network "$NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- get_admin 2>&1 | tr -d '"')

if [ "$ACTUAL_ADMIN" != "$ADMIN_ADDRESS" ]; then
  echo "❌ Admin verification failed (expected $ADMIN_ADDRESS, got $ACTUAL_ADMIN)"
  exit 1
fi
echo "   Admin verified: $ACTUAL_ADMIN"
echo "✅ Initialization verified!"
echo ""

# ── Write deployment record ───────────────────────────────────────────────────
mkdir -p "$DEPLOYMENT_RECORD_DIR"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
RECORD_FILE="$DEPLOYMENT_RECORD_DIR/testnet_${TIMESTAMP}.txt"

cat > "$RECORD_FILE" << RECORD
network:      testnet
timestamp:    $TIMESTAMP
contract_id:  $CONTRACT_ID
wasm_hash:    $WASM_HASH
wasm_size:    $WASM_SIZE bytes
admin:        $ADMIN_ADDRESS
token:        $TOKEN_ADDRESS
threshold:    $MULTISIG_THRESHOLD
rpc_url:      $RPC_URL
RECORD

echo "📝 Deployment record: $RECORD_FILE"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "contract_id=$CONTRACT_ID" >> "$GITHUB_OUTPUT"
  echo "wasm_hash=$WASM_HASH" >> "$GITHUB_OUTPUT"
fi

echo ""
echo "🎉 Testnet deployment complete!"
