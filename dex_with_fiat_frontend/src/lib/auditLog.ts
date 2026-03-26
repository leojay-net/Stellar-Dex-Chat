import fs from 'fs';
import path from 'path';

export interface AuditEntry {
  id: string;
  adminAction: string;
  txHash: string;
  metadata: Record<string, any>;
  timestamp: string;
}

const LOG_FILE_PATH = path.join(process.cwd(), 'audit_log.json');

/**
 * Records an admin action to the append-only log.
 */
export async function recordAuditEntry(entry: Omit<AuditEntry, 'id' | 'timestamp'>) {
  const newEntry: AuditEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };

  let logs: AuditEntry[] = [];
  if (fs.existsSync(LOG_FILE_PATH)) {
    const fileData = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
    logs = JSON.parse(fileData);
  }

  logs.push(newEntry);
  fs.writeFileSync(LOG_FILE_PATH, JSON.stringify(logs, null, 2));
  return newEntry;
}

/**
 * Retrieves all audit entries.
 */
export async function getAuditEntries(): Promise<AuditEntry[]> {
  if (!fs.existsSync(LOG_FILE_PATH)) return [];
  const fileData = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
  return JSON.parse(fileData);
}