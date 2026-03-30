/**
 * Audit Log Module
 * Provides append-only logging for admin actions with transaction metadata
 * Stores entries in localStorage for persistence across sessions
 */

export interface AuditEntry {
  id: string;
  timestamp: Date;
  adminAddress: string;
  actionType: 'deposit' | 'payout' | 'reconciliation' | 'user_update' | 'settings_change';
  actionDescription: string;
  txHash?: string;
  metadata: Record<string, unknown>;
  status: 'success' | 'failed' | 'pending';
}

export interface AuditLogFilter {
  actionType?: AuditEntry['actionType'];
  adminAddress?: string;
  startDate?: Date;
  endDate?: Date;
  status?: AuditEntry['status'];
  txHash?: string;
}

const AUDIT_LOG_STORAGE_KEY = 'audit_log_entries';
const MAX_LOG_ENTRIES = 10000; // Prevent unbounded growth

class AuditLogService {
  /**
   * Record an admin action in the append-only log
   * Entries are immutable once written
   */
  static recordAction(
    adminAddress: string,
    actionType: AuditEntry['actionType'],
    actionDescription: string,
    metadata: Record<string, unknown>,
    txHash?: string,
    status: AuditEntry['status'] = 'success'
  ): AuditEntry {
    const entry: AuditEntry = {
      id: this.generateId(),
      timestamp: new Date(),
      adminAddress,
      actionType,
      actionDescription,
      txHash,
      metadata,
      status,
    };

    // Append to log (immutable operation)
    this.appendEntry(entry);
    return entry;
  }

  /**
   * Retrieve all audit entries with optional filtering
   * Read-only operation - does not modify the log
   */
  static getAuditEntries(filter?: AuditLogFilter): AuditEntry[] {
    const entries = this.getAllEntries();
    
    if (!filter) {
      return entries;
    }

    return entries.filter((entry) => {
      if (filter.actionType && entry.actionType !== filter.actionType) {
        return false;
      }
      if (filter.adminAddress && entry.adminAddress !== filter.adminAddress) {
        return false;
      }
      if (filter.status && entry.status !== filter.status) {
        return false;
      }
      if (filter.txHash && entry.txHash !== filter.txHash) {
        return false;
      }
      if (filter.startDate && new Date(entry.timestamp) < filter.startDate) {
        return false;
      }
      if (filter.endDate && new Date(entry.timestamp) > filter.endDate) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get audit entries for a specific admin address
   */
  static getEntriesByAdmin(adminAddress: string): AuditEntry[] {
    return this.getAuditEntries({ adminAddress });
  }

  /**
   * Get audit entries by action type
   */
  static getEntriesByActionType(actionType: AuditEntry['actionType']): AuditEntry[] {
    return this.getAuditEntries({ actionType });
  }

  /**
   * Get entry by transaction hash
   */
  static getEntryByTxHash(txHash: string): AuditEntry | undefined {
    const entries = this.getAuditEntries({ txHash });
    return entries[0];
  }

  /**
   * Get recent entries (last N entries)
   */
  static getRecentEntries(limit: number = 100): AuditEntry[] {
    const entries = this.getAllEntries();
    return entries.slice(-limit).reverse();
  }

  /**
   * Get total count of audit entries
   */
  static getEntryCount(): number {
    return this.getAllEntries().length;
  }

  /**
   * Export audit log as JSON (for compliance/backup)
   */
  static exportLog(): string {
    const entries = this.getAllEntries();
    return JSON.stringify(entries, null, 2);
  }

  /**
   * Clear audit log (admin-only operation - use with caution)
   * This should only be called in test environments or with proper authorization
   */
  static clearLog(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(AUDIT_LOG_STORAGE_KEY);
    }
  }

  // ============ Private Helper Methods ============

  private static appendEntry(entry: AuditEntry): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      console.warn('localStorage not available');
      return;
    }

    const entries = this.getAllEntries();
    
    // Maintain size limit - remove oldest entries if necessary
    if (entries.length >= MAX_LOG_ENTRIES) {
      entries.splice(0, Math.floor(MAX_LOG_ENTRIES * 0.1)); // Remove oldest 10%
    }

    entries.push(entry);
    window.localStorage.setItem(AUDIT_LOG_STORAGE_KEY, JSON.stringify(entries));
  }

  private static getAllEntries(): AuditEntry[] {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }

    const stored = window.localStorage.getItem(AUDIT_LOG_STORAGE_KEY);
    if (!stored) {
      return [];
    }

    try {
      const entries = JSON.parse(stored) as AuditEntry[];
      // Ensure timestamps are Date objects
      return entries.map((entry) => ({
        ...entry,
        timestamp: new Date(entry.timestamp),
      }));
    } catch (error) {
      console.error('Failed to parse audit log from storage:', error);
      return [];
    }
  }

  private static generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default AuditLogService;
