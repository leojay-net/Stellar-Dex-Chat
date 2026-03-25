/**
 * Test script to validate environment variable validation
 * This simulates missing environment variables to test fail-fast behavior
 */

// Simulate missing environment variables
const originalEnv = { ...process.env };

// Test 1: Missing required environment variables
console.log('🧪 Test 1: Missing required environment variables');
console.log('=' .repeat(50));

// Clear required environment variables
delete process.env.PAYSTACK_SECRET_KEY;
delete process.env.NEXT_PUBLIC_GEMINI_API_KEY;

try {
  // Clear the module cache to force re-validation
  delete require.cache[require.resolve('./src/lib/env.ts')];
  
  // This should fail with descriptive error
  require('./src/lib/env.ts');
  console.log('❌ Test 1 FAILED: Should have thrown an error');
} catch (error) {
  console.log('✅ Test 1 PASSED: Fail-fast error thrown correctly');
  console.log('Error message:');
  console.log(error.message);
}

console.log('\n' + '=' .repeat(50));

// Test 2: Valid environment variables
console.log('🧪 Test 2: Valid environment variables');
console.log('=' .repeat(50));

// Set valid environment variables
process.env.PAYSTACK_SECRET_KEY = 'sk_test_valid_secret_key_12345678901234567890';
process.env.NEXT_PUBLIC_GEMINI_API_KEY = 'valid_gemini_api_key_12345678901234567890';

try {
  // Clear the module cache to force re-validation
  delete require.cache[require.resolve('./src/lib/env.ts')];
  
  // This should succeed
  const { env, isDevelopment, isProduction, telemetryEnabled } = require('./src/lib/env.ts');
  
  console.log('✅ Test 2 PASSED: Environment validation succeeded');
  console.log('Environment variables loaded:');
  console.log('- PAYSTACK_SECRET_KEY:', env.PAYSTACK_SECRET_KEY ? '✅ Present' : '❌ Missing');
  console.log('- NEXT_PUBLIC_GEMINI_API_KEY:', env.NEXT_PUBLIC_GEMINI_API_KEY ? '✅ Present' : '❌ Missing');
  console.log('- NEXT_PUBLIC_STELLAR_RPC_URL:', env.NEXT_PUBLIC_STELLAR_RPC_URL);
  console.log('- NODE_ENV:', env.NODE_ENV);
  console.log('- isDevelopment:', isDevelopment);
  console.log('- telemetryEnabled:', telemetryEnabled);
} catch (error) {
  console.log('❌ Test 2 FAILED: Should not have thrown an error');
  console.log('Error:', error.message);
}

// Restore original environment
process.env = originalEnv;

console.log('\n🎯 Environment validation tests completed!');
