# E2E Tests for Stellar Dex Chat

This directory contains end-to-end tests for the Stellar Dex Chat application using Playwright.

## Test Coverage

### 1. Wallet Connect UI Path (`wallet-connect.spec.ts`)

- ✅ Display connect wallet button when not connected
- ✅ Navigate to chat page and show wallet connection options
- ✅ Handle wallet connection flow with mocked Freighter API
- ✅ Handle wallet disconnection
- ✅ Show error when Freighter is not installed

### 2. Deposit Modal Validation and Success State (`deposit-modal.spec.ts`)

- ✅ Open deposit modal when deposit button is clicked
- ✅ Validate amount input (empty, negative, zero amounts)
- ✅ Accept valid amount and show loading state
- ✅ Show success state after successful deposit
- ✅ Show error state for failed transactions
- ✅ Close modal functionality
- ✅ Display wallet connection info
- ✅ Disable submit when wallet not connected

### 3. Payout Form and Mocked Transfer Initiation (`payout-form.spec.ts`)

- ✅ Open payout modal when withdraw button is clicked
- ✅ Show recipient address field in withdraw mode
- ✅ Validate recipient address format
- ✅ Accept valid Stellar address format
- ✅ Allow withdrawal to self when recipient is blank
- ✅ Show loading state during withdrawal processing
- ✅ Show success state after successful withdrawal
- ✅ Show error state for failed withdrawal
- ✅ Validate withdrawal amount
- ✅ Display correct wallet info for withdrawal
- ✅ Handle withdrawal to different recipient
- ✅ Close modal after successful withdrawal
- ✅ Disable withdrawal when wallet not connected

## Running Tests

### Prerequisites

- Install Playwright browsers: `npm run test:e2e:install`

### Commands

- Run all tests: `npm run test:e2e`
- Run tests with UI: `npm run test:e2e:ui`
- Run tests in debug mode: `npm run test:e2e:debug`

### Individual Test Files

- Run wallet tests: `npm run test:e2e wallet-connect.spec.ts`
- Run deposit tests: `npm run test:e2e deposit-modal.spec.ts`
- Run payout tests: `npm run test:e2e payout-form.spec.ts`

## Test Configuration

The tests are configured in `playwright.config.ts` with:

- Multi-browser testing (Chrome, Firefox, Safari)
- Automatic server startup
- Screenshot capture on failure
- Trace collection for debugging
- HTML reporter

## Mocking

The tests use mocked Freighter wallet API to simulate:

- Wallet connection/disconnection
- Transaction signing
- Network detection
- Error scenarios

## Acceptance Criteria Met

✅ **Add e2e test for connect wallet UI path**
✅ **Add e2e test for deposit modal validation and success state**
✅ **Add e2e test for payout form and mocked transfer initiation**

All tests provide clear validation output and cover both success and error scenarios for each feature.

## Content Security Policy

Import the shared `test` fixture from `./fixtures`. It records browser CSP
violations before page scripts run and fails the test if any were reported.
CI runs these flows against a production build.
