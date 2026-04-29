# PR: Wave 67 - Payout Cancellation Feature

Closes #ISSUE_NUMBER

## ✅ What this PR adds
- `src/app/api/initiate-transfer/route.ts`: Removed dead / legacy Paystack code and enforce logic using configured payout providers.
- `src/app/api/transfer-status/[reference]/route.ts`: Implemented `GET` route to serve payment cancellation request status, completing the backend cancellation state tracking.
- `src/components/BankDetailsModal.tsx`: Added an option to `Cancel Payout` inside the transaction timeline itself when a payment is newly initiated (< 2 min) and user is awaiting bank confirmations.
- `src/hooks/useNotifications.ts`: Included supporting `payout_cancelled` type to safely log UI notifications.

## 🎯 Acceptance criteria coverage
1. Expose Cancel action for newly initiated payouts within 2 minutes.
   - Displayed and functional directly in the chat history sidebar and `BankDetailsModal` timeline immediately after confirming payout.
2. Create backend route to mark cancellation request state.
   - Implemented `GET` logic in `api/transfer-status/[reference]/route.ts` along with existing `POST` modification state.
3. Display cancellation status in timeline and history.
   - History entry lists payout as strictly `Cancelled` when cancelled by the user. `TransferTimeline` incorporates native `cancelled` rendering state.

## 🧪 Validation
Run:
```bash
cd dex_with_fiat_frontend
npm install
npm run build
```
Build succeeded (no errors).

## 📸 Proof / attachment
- [ ] attach screenshot showing updated `Cancelled` action in the UI feed and timeline.

**How to attach proof:**
1. Wait for dev completion, click cancel while pending transfer.
2. Check network logs confirming `POST /api/transfer-status/[reference]`.
3. Check `TransferTimeline` transitions into grey Cancelled pill.
4. Save screenshot and upload as PR attachment to this issue.

> Attach screenshot below when ready:
>
> ![Attachment placeholder](./attachment.png)

