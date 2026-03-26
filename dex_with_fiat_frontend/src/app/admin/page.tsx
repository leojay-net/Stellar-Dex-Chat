"use client";

import { useEffect, useState } from 'react';
import { AuditEntry } from '@/lib/auditLog';

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetch('/api/admin-audit')
      .then(res => res.json())
      .then(data => setLogs(data));
  }, []);

  const filteredLogs = logs.filter(log => 
    log.txHash.toLowerCase().includes(filter.toLowerCase()) ||
    log.adminAction.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">System Audit Logs</h1>
      
      <input 
        type="text" 
        placeholder="Filter by action or Tx Hash..."
        className="w-full p-2 mb-4 border rounded bg-slate-50 text-black"
        onChange={(e) => setFilter(e.target.value)}
      />

      <div className="overflow-x-auto border rounded-lg">
        <table className="min-w-full bg-white text-sm">
          <thead className="bg-slate-100 border-b">
            <tr>
              <th className="p-4 text-left">Timestamp</th>
              <th className="p-4 text-left">Action</th>
              <th className="p-4 text-left">Stellar Tx Hash</th>
              <th className="p-4 text-left">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map((log) => (
              <tr key={log.id} className="border-b hover:bg-slate-50">
                <td className="p-4 text-gray-500">{new Date(log.timestamp).toLocaleString()}</td>
                <td className="p-4 font-medium">{log.adminAction}</td>
                <td className="p-4 font-mono text-blue-600 truncate max-w-[200px]">{log.txHash}</td>
                <td className="p-4 text-xs text-gray-400">{JSON.stringify(log.metadata)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}