/**
 * Audit Logging Usage Examples
 * 
 * This file demonstrates how to use the AuditLogService throughout the application
 * to record admin actions and blockchain transactions.
 */

import AuditLogService from '@/lib/auditLog';

/**
 * Example 1: Record a successful deposit action
 */
export function recordDepositAction(
  adminAddress: string,
  amount: string,
  recipientAddress: string,
  txHash: string
) {
  return AuditLogService.recordAction(
    adminAddress,
    'deposit',
    `Processed deposit of ${amount} XLM to ${recipientAddress}`,
    {
      amount,
      recipientAddress,
      timestamp: new Date().toISOString(),
    },
    txHash,
    'success'
  );
}

/**
 * Example 2: Record a payout action
 */
export function recordPayoutAction(
  adminAddress: string,
  amount: string,
  bankAccount: string,
  reference: string,
  txHash?: string
) {
  return AuditLogService.recordAction(
    adminAddress,
    'payout',
    `Initiated payout of ${amount} to account ${bankAccount}`,
    {
      amount,
      bankAccount,
      reference,
      timestamp: new Date().toISOString(),
    },
    txHash,
    'success'
  );
}

/**
 * Example 3: Record a failed transaction
 */
export function recordFailedTransaction(
  adminAddress: string,
  actionType: 'deposit' | 'payout' | 'reconciliation',
  description: string,
  errorDetails: Record<string, unknown>
) {
  return AuditLogService.recordAction(
    adminAddress,
    actionType,
    description,
    {
      error: errorDetails,
      timestamp: new Date().toISOString(),
    },
    undefined,
    'failed'
  );
}

/**
 * Example 4: Record a reconciliation action
 */
export function recordReconciliationAction(
  adminAddress: string,
  recordsProcessed: number,
  discrepancies: number
) {
  return AuditLogService.recordAction(
    adminAddress,
    'reconciliation',
    `Reconciliation completed: ${recordsProcessed} records processed, ${discrepancies} discrepancies found`,
    {
      recordsProcessed,
      discrepancies,
      timestamp: new Date().toISOString(),
    },
    undefined,
    'success'
  );
}

/**
 * Example 5: Record a user update action
 */
export function recordUserUpdateAction(
  adminAddress: string,
  targetUserAddress: string,
  updateDetails: Record<string, unknown>
) {
  return AuditLogService.recordAction(
    adminAddress,
    'user_update',
    `Updated user ${targetUserAddress}`,
    {
      targetUserAddress,
      changes: updateDetails,
      timestamp: new Date().toISOString(),
    },
    undefined,
    'success'
  );
}

/**
 * Example 6: Record a settings change
 */
export function recordSettingsChangeAction(
  adminAddress: string,
  settingKey: string,
  oldValue: unknown,
  newValue: unknown
) {
  return AuditLogService.recordAction(
    adminAddress,
    'settings_change',
    `Changed setting: ${settingKey}`,
    {
      settingKey,
      oldValue,
      newValue,
      timestamp: new Date().toISOString(),
    },
    undefined,
    'success'
  );
}

/**
 * Example usage in a transaction handler:
 * 
 * async function handleDeposit(adminAddress: string, amount: string) {
 *   try {
 *     // Process deposit...
 *     const txResult = await processDeposit(amount);
 *     
 *     // Record successful action
 *     recordDepositAction(
 *       adminAddress,
 *       amount,
 *       recipientAddress,
 *       txResult.hash
 *     );
 *     
 *     return { success: true, txHash: txResult.hash };
 *   } catch (error) {
 *     // Record failed action
 *     recordFailedTransaction(
 *       adminAddress,
 *       'deposit',
 *       `Failed to process deposit of ${amount} XLM`,
 *       { error: (error as Error).message }
 *     );
 *     
 *     throw error;
 *   }
 * }
 */

const auditLogExamples = {
  recordDepositAction,
  recordPayoutAction,
  recordFailedTransaction,
  recordReconciliationAction,
  recordUserUpdateAction,
  recordSettingsChangeAction,
};

export default auditLogExamples;
