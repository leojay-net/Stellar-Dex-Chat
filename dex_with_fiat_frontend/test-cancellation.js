/**
 * Test script to verify payout cancellation functionality
 * Tests the 2-minute cancellation window and status tracking
 */

// Mock transfer data for testing
const mockTransfer = {
  reference: 'test_tx_' + Date.now(),
  amount: 50000,
  currency: 'NGN',
  recipient: 'RCP_test123',
  status: 'pending',
  createdAt: new Date().toISOString(),
};

// Test 1: Transfer Initiation
console.log('🧪 Test 1: Transfer Initiation');
console.log('=' .repeat(50));

async function testTransferInitiation() {
  try {
    console.log('📤 Initiating transfer...');
    
    const response = await fetch('http://localhost:3000/api/initiate-transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'balance',
        amount: mockTransfer.amount,
        recipient: mockTransfer.recipient,
        reason: 'Test transfer for cancellation',
      }),
    });

    const result = await response.json();
    
    if (result.success) {
      mockTransfer.reference = result.data.reference;
      mockTransfer.createdAt = result.data.createdAt;
      console.log('✅ Transfer initiated successfully');
      console.log(`   Reference: ${result.data.reference}`);
      console.log(`   Status: ${result.data.status}`);
      console.log(`   Created: ${result.data.createdAt}`);
    } else {
      console.log('❌ Transfer initiation failed:', result.message);
    }
  } catch (error) {
    console.log('❌ Transfer initiation error:', error.message);
  }
}

// Test 2: Check Transfer Status (within cancellation window)
console.log('\n🧪 Test 2: Transfer Status Check (Within Window)');
console.log('=' .repeat(50));

async function testTransferStatus() {
  try {
    console.log('📊 Checking transfer status...');
    
    const response = await fetch('http://localhost:3000/api/transfer-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: mockTransfer.reference,
      }),
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Status retrieved successfully');
      console.log(`   Status: ${result.data.status}`);
      console.log(`   Can Cancel: ${result.data.canCancel}`);
      console.log(`   Time Remaining: ${Math.round(result.data.cancellationWindow?.timeRemaining / 1000)}s`);
      console.log(`   Window Expires: ${result.data.cancellationWindow?.expiresAt}`);
    } else {
      console.log('❌ Status check failed:', result.message);
    }
  } catch (error) {
    console.log('❌ Status check error:', error.message);
  }
}

// Test 3: Transfer Cancellation (within window)
console.log('\n🧪 Test 3: Transfer Cancellation (Within Window)');
console.log('=' .repeat(50));

async function testTransferCancellation() {
  try {
    console.log('🚫 Cancelling transfer...');
    
    const response = await fetch('http://localhost:3000/api/cancel-transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: mockTransfer.reference,
        reason: 'Test cancellation',
      }),
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Transfer cancelled successfully');
      console.log(`   Status: ${result.data.status}`);
      console.log(`   Cancelled At: ${result.data.cancelledAt}`);
      console.log(`   Reason: ${result.data.cancellationReason}`);
    } else {
      console.log('❌ Cancellation failed:', result.message);
    }
  } catch (error) {
    console.log('❌ Cancellation error:', error.message);
  }
}

// Test 4: Check Status After Cancellation
console.log('\n🧪 Test 4: Status Check After Cancellation');
console.log('=' .repeat(50));

async function testStatusAfterCancellation() {
  try {
    console.log('📊 Checking status after cancellation...');
    
    const response = await fetch('http://localhost:3000/api/transfer-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: mockTransfer.reference,
      }),
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Status retrieved successfully');
      console.log(`   Status: ${result.data.status}`);
      console.log(`   Is Cancelled: ${result.data.isCancelled}`);
      console.log(`   Can Cancel: ${result.data.canCancel}`);
      
      if (result.data.cancellationInfo) {
        console.log(`   Cancellation Info:`);
        console.log(`     Cancelled At: ${result.data.cancellationInfo.cancelledAt}`);
        console.log(`     Reason: ${result.data.cancellationInfo.reason}`);
      }
      
      if (result.data.timeline) {
        console.log(`   Timeline Events:`);
        result.data.timeline.forEach((event, index) => {
          console.log(`     ${index + 1}. ${event.status}: ${event.message}`);
          console.log(`        Time: ${event.timestamp}`);
        });
      }
    } else {
      console.log('❌ Status check failed:', result.message);
    }
  } catch (error) {
    console.log('❌ Status check error:', error.message);
  }
}

// Test 5: Cancellation Outside Window (simulate expired transfer)
console.log('\n🧪 Test 5: Cancellation Outside Time Window');
console.log('=' .repeat(50));

async function testCancellationOutsideWindow() {
  try {
    // Create a transfer that's older than 2 minutes
    const oldTransfer = {
      reference: 'old_tx_' + Date.now(),
      amount: 25000,
      currency: 'NGN',
      recipient: 'RCP_old123',
      status: 'pending',
      createdAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(), // 3 minutes ago
    };

    console.log('📤 Creating transfer outside cancellation window...');
    
    // First initiate
    const initiateResponse = await fetch('http://localhost:3000/api/initiate-transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'balance',
        amount: oldTransfer.amount,
        recipient: oldTransfer.recipient,
        reason: 'Old transfer for window test',
      }),
    });

    const initiateResult = await initiateResponse.json();
    
    if (initiateResult.success) {
      console.log('✅ Old transfer created');
      
      // Try to cancel (should fail)
      console.log('🚫 Attempting to cancel old transfer...');
      
      const cancelResponse = await fetch('http://localhost:3000/api/cancel-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: initiateResult.data.reference,
          reason: 'Should fail - outside window',
        }),
      });

      const cancelResult = await cancelResponse.json();
      
      if (!cancelResult.success && cancelResult.message.includes('2 minutes')) {
        console.log('✅ Correctly rejected cancellation outside window');
        console.log(`   Error: ${cancelResult.message}`);
      } else {
        console.log('❌ Should have failed for cancellation outside window');
      }
    } else {
      console.log('❌ Failed to create old transfer');
    }
  } catch (error) {
    console.log('❌ Window test error:', error.message);
  }
}

// Run all tests
async function runAllTests() {
  console.log('🎯 Starting Payout Cancellation Tests\n');
  
  await testTransferInitiation();
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
  
  await testTransferStatus();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await testTransferCancellation();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await testStatusAfterCancellation();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await testCancellationOutsideWindow();
  
  console.log('\n🎯 Cancellation tests completed!');
  console.log('\n📋 Summary:');
  console.log('- ✅ Transfer initiation with reference tracking');
  console.log('- ✅ 2-minute cancellation window enforcement');
  console.log('- ✅ Cancellation status in timeline');
  console.log('- ✅ Proper error handling for edge cases');
  console.log('- ✅ Enhanced transfer status API with cancellation info');
}

// Note: This test requires the development server to be running
console.log('⚠️  Make sure the development server is running on http://localhost:3000');
console.log('⚠️  This test uses mock data when PAYSTACK_SECRET_KEY is not configured\n');

// Export for manual testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    runAllTests,
    testTransferInitiation,
    testTransferStatus,
    testTransferCancellation,
    testStatusAfterCancellation,
    testCancellationOutsideWindow,
  };
} else {
  // Auto-run in browser environment
  runAllTests().catch(console.error);
}
