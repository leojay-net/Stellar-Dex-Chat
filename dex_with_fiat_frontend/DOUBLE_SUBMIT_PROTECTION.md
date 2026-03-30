# Double-Submit Protection Implementation

This document describes the implementation of guardrails to prevent accidental double-submit actions in the application.

## Overview

The implementation adds idempotent button disabled/loading states for critical actions, prevents duplicate form submit events, logs suppressed duplicates for diagnostics, and includes comprehensive tests for rapid-click scenarios.

## Core Implementation

### useIdempotentAction Hook

Location: `src/hooks/useIdempotentAction.ts`

A reusable React hook that provides idempotency guarantees for critical actions:

**Features:**

- Prevents duplicate submissions during configurable cooldown period (default: 2000ms)
- Tracks processing state for UI feedback
- Generates unique idempotency keys per action
- Logs suppressed duplicate attempts for diagnostics
- Handles errors gracefully

**Usage:**

```typescript
const { execute, isProcessing } = useIdempotentAction({
  cooldownMs: 2000,
  logSuppressed: true,
});

const handleSubmit = async () => {
  await execute(async (idempotencyKey) => {
    // Your action here
    await fetch('/api/endpoint', {
      headers: {
        'X-Idempotency-Key': idempotencyKey,
      },
    });
  }, 'action_name');
};
```

## Protected Components

### 1. ChatInput Component

Location: `src/components/ChatInput.tsx`

**Protection Added:**

- Prevents duplicate message submissions on rapid Enter key presses
- Prevents duplicate submissions on rapid button clicks
- Cooldown period: 1000ms
- Disables submit button while processing

**Changes:**

- Added `useIdempotentAction` hook
- Wrapped `onSendMessage` call in `executeSubmit`
- Added `isSubmitting` state to button disabled condition
- Updated loading spinner to show during submission

### 2. BankDetailsModal Component

Location: `src/components/BankDetailsModal.tsx`

**Protection Added:**

- Prevents duplicate payout confirmations
- Cooldown period: 3000ms (longer due to critical financial operation)
- Includes idempotency keys in API requests
- Disables confirm button while processing

**Changes:**

- Added `useIdempotentAction` hook
- Wrapped payout confirmation logic in `executePayoutConfirm`
- Added `X-Idempotency-Key` header to `/api/create-recipient` and `/api/initiate-transfer` requests
- Added `isPayoutProcessing` to button disabled condition

### 3. StellarFiatModal Component

Location: `src/components/StellarFiatModal.tsx`

**Protection Added:**

- Prevents duplicate deposit/withdrawal transactions
- Cooldown period: 2000ms
- Generates unique idempotency keys for blockchain transactions
- Disables action button while processing

**Changes:**

- Added `useIdempotentAction` hook (replacing manual cooldown logic)
- Wrapped transaction logic in `executeTransaction`
- Removed manual `lastActionTimestamp` checks (now handled by hook)
- Added `isTxProcessing` to button disabled condition
- Idempotency key passed to transaction handlers

## Diagnostic Logging

All suppressed duplicate attempts are logged to the console with the following information:

```javascript
{
  actionName: 'action_name',
  isProcessing: boolean,
  timeSinceLastExecution: number,
  cooldownMs: number,
  timestamp: ISO string
}
```

This allows developers and support teams to:

- Identify UI/UX issues causing users to double-click
- Monitor for potential bugs or race conditions
- Track user behavior patterns
- Debug submission issues

## Testing

### Unit Tests

Location: `src/hooks/__tests__/useIdempotentAction.test.ts`

Tests cover:

- ✅ Successful action execution
- ✅ Duplicate submission prevention during cooldown
- ✅ Execution allowed after cooldown period
- ✅ Processing state tracking
- ✅ Suppressed duplicate logging
- ✅ Unique idempotency key generation
- ✅ State reset functionality
- ✅ Error handling
- ✅ Rapid-click scenarios
- ✅ Blocking submissions while processing

### Integration Tests

**ChatInput Tests**
Location: `src/components/__tests__/ChatInput.rapid-click.test.tsx`

Tests cover:

- ✅ Preventing duplicate submissions on rapid Enter presses
- ✅ Preventing duplicate submissions on rapid button clicks
- ✅ Button disabled state while processing
- ✅ Submission allowed after cooldown
- ✅ No submission when loading
- ✅ Logging suppressed attempts
- ✅ Input clearing after submission
- ✅ Form submission event handling

**BankDetailsModal Tests**
Location: `src/components/__tests__/BankDetailsModal.rapid-click.test.tsx`

Tests cover:

- ✅ Preventing duplicate payout confirmations
- ✅ Idempotency key inclusion in API requests
- ✅ Button disabled state while processing
- ✅ Logging suppressed attempts

## API Integration

### Idempotency Keys

All critical API endpoints should accept and respect the `X-Idempotency-Key` header:

```typescript
headers: {
  'Content-Type': 'application/json',
  'X-Idempotency-Key': idempotencyKey,
}
```

**Format:** `{action_name}_{timestamp}_{random_string}`

**Example:** `payout_confirm_1234567890_abc123def`

### Backend Implementation (Recommended)

API routes should:

1. Extract the `X-Idempotency-Key` header
2. Check if a request with this key was already processed
3. Return the cached response if found
4. Process the request and cache the response if new
5. Set appropriate cache expiration (e.g., 24 hours)

## Configuration

### Cooldown Periods

Different actions have different cooldown periods based on their criticality:

- **Chat messages:** 1000ms (1 second)
- **Stellar transactions:** 2000ms (2 seconds)
- **Fiat payouts:** 3000ms (3 seconds)

These can be adjusted in each component's `useIdempotentAction` configuration.

### Logging

Suppressed duplicate logging can be disabled per component:

```typescript
useIdempotentAction({
  cooldownMs: 2000,
  logSuppressed: false, // Disable logging
});
```

## Benefits

1. **User Experience:** Prevents accidental duplicate transactions
2. **Data Integrity:** Ensures idempotent operations
3. **Debugging:** Comprehensive logging for diagnostics
4. **Maintainability:** Reusable hook pattern
5. **Testing:** Full test coverage for rapid-click scenarios
6. **Performance:** Minimal overhead with efficient state management

## Future Enhancements

Potential improvements:

- Server-side idempotency key validation
- Persistent idempotency key storage (beyond localStorage)
- Visual feedback for suppressed attempts
- Analytics integration for duplicate attempt tracking
- Configurable retry strategies
- Network-aware cooldown adjustments
