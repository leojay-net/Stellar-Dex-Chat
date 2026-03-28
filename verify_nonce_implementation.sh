#!/bin/bash

echo "=== Verifying Nonce-Based Replay Protection Implementation ==="
echo ""

# Check if the new storage key exists
echo "1. Checking for OperatorNonce storage key..."
if grep -q "OperatorNonce(Address)" stellar-contracts/src/lib.rs; then
    echo "   ✓ OperatorNonce storage key found"
else
    echo "   ✗ OperatorNonce storage key NOT found"
    exit 1
fi

# Check if the new error codes exist
echo ""
echo "2. Checking for new error codes..."
if grep -q "InvalidNonce = 901" stellar-contracts/src/lib.rs; then
    echo "   ✓ InvalidNonce error code found"
else
    echo "   ✗ InvalidNonce error code NOT found"
    exit 1
fi

if grep -q "StaleNonce = 902" stellar-contracts/src/lib.rs; then
    echo "   ✓ StaleNonce error code found"
else
    echo "   ✗ StaleNonce error code NOT found"
    exit 1
fi

# Check if get_operator_nonce function exists
echo ""
echo "3. Checking for get_operator_nonce function..."
if grep -q "pub fn get_operator_nonce" stellar-contracts/src/lib.rs; then
    echo "   ✓ get_operator_nonce function found"
else
    echo "   ✗ get_operator_nonce function NOT found"
    exit 1
fi

# Check if validate_and_increment_nonce function exists
echo ""
echo "4. Checking for validate_and_increment_nonce function..."
if grep -q "fn validate_and_increment_nonce" stellar-contracts/src/lib.rs; then
    echo "   ✓ validate_and_increment_nonce function found"
else
    echo "   ✗ validate_and_increment_nonce function NOT found"
    exit 1
fi

# Check if heartbeat function has been updated with nonce parameter
echo ""
echo "5. Checking if heartbeat function accepts nonce parameter..."
if grep -q "pub fn heartbeat(env: Env, operator: Address, nonce: u64)" stellar-contracts/src/lib.rs; then
    echo "   ✓ heartbeat function updated with nonce parameter"
else
    echo "   ✗ heartbeat function NOT updated with nonce parameter"
    exit 1
fi

# Check if heartbeat calls validate_and_increment_nonce
echo ""
echo "6. Checking if heartbeat validates nonce..."
if grep -A 20 "pub fn heartbeat" stellar-contracts/src/lib.rs | grep -q "validate_and_increment_nonce"; then
    echo "   ✓ heartbeat function validates nonce"
else
    echo "   ✗ heartbeat function does NOT validate nonce"
    exit 1
fi

# Check if tests exist
echo ""
echo "7. Checking for nonce-related tests..."
test_count=$(grep -c "fn test_.*nonce" stellar-contracts/src/test.rs)
if [ "$test_count" -ge 10 ]; then
    echo "   ✓ Found $test_count nonce-related tests"
else
    echo "   ✗ Only found $test_count nonce-related tests (expected at least 10)"
    exit 1
fi

# Check if ERROR_CODES.md has been updated
echo ""
echo "8. Checking ERROR_CODES.md documentation..."
if grep -q "InvalidNonce" ERROR_CODES.md && grep -q "StaleNonce" ERROR_CODES.md; then
    echo "   ✓ ERROR_CODES.md updated with new error codes"
else
    echo "   ✗ ERROR_CODES.md NOT updated with new error codes"
    exit 1
fi

# Check if documentation exists
echo ""
echo "9. Checking for implementation documentation..."
if [ -f "NONCE_REPLAY_PROTECTION.md" ]; then
    echo "   ✓ NONCE_REPLAY_PROTECTION.md documentation found"
else
    echo "   ✗ NONCE_REPLAY_PROTECTION.md documentation NOT found"
    exit 1
fi

echo ""
echo "=== All Verification Checks Passed! ==="
echo ""
echo "Summary of changes:"
echo "  - Added OperatorNonce storage key for per-operator nonce tracking"
echo "  - Added InvalidNonce (901) and StaleNonce (902) error codes"
echo "  - Added get_operator_nonce() public function"
echo "  - Added validate_and_increment_nonce() internal function"
echo "  - Updated heartbeat() to require and validate nonces"
echo "  - Added $test_count comprehensive tests for replay protection"
echo "  - Updated ERROR_CODES.md with new error codes"
echo "  - Created NONCE_REPLAY_PROTECTION.md documentation"
echo ""
echo "Next steps:"
echo "  1. Run: cd stellar-contracts && cargo test --lib"
echo "  2. Review test results to ensure all tests pass"
echo "  3. Deploy updated contract to test environment"
echo "  4. Update client applications to use new heartbeat signature"
echo ""
