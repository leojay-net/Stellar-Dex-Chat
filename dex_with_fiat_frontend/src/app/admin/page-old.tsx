'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AdminAuditActionType,
  AdminAuditLogEntry,
  ReconciliationRecord,
} from '@/types';
import { aggregateDailyVolume, DailyMetric } from '@/lib/analytics';
import { aggregatePayoutMetrics } from '@/lib/adminMetrics';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import AuditTable from '@/components/AuditTable';
import useBridgeStats from '@/hooks/useBridgeStats';
import AdminGuard from '@/components/AdminGuard';
import { stroopsToDisplay } from '@/lib/stellarContract';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import Link from 'next/link';

type AuditLogResponse = {
  entries: AdminAuditLogEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  actions: AdminAuditActionType[];
};

const ACTION_LABELS: Record<AdminAuditActionType, string> = {
  withdrawal_approved: 'Withdrawal Approved',
  withdrawal_rejected: 'Withdrawal Rejected',
  reconciliation_adjustment: 'Reconciliation Adjustment',
  operator_added: 'Operator Added',
  operator_removed: 'Operator Removed',
  bridge_paused: 'Bridge Paused',
  bridge_unpaused: 'Bridge Unpaused',
};

function formatActionLabel(action: AdminAuditActionType): string {
  return ACTION_LABELS[action] ?? action;
}

function formatParameters(
  parameters: Record<string, string | number | boolean | null>,
): string {
  return Object.entries(parameters)
    .map(([key, value]) => `${key}: ${value === null ? 'null' : String(value)}`)
    .join(' | ');
}

function escapeCsvValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export default function AdminDashboard() {
  const [reconciliationRecords, setReconciliationRecords] = useState<
    ReconciliationRecord[]
  >([]);
  const [metrics, setMetrics] = useState<DailyMetric[]>([]);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [auditEntries, setAuditEntries] = useState<AdminAuditLogEntry[]>([]);
  const [auditActions, setAuditActions] = useState<AdminAuditActionType[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(20);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [exportingCsv, setExportingCsv] = useState(false);
  const enableAdminReconciliation = useFeatureFlag('enableAdminReconciliation');

  const { balance, totalDeposited } = useBridgeStats();

  const payoutMetrics = useMemo(() => {
    return aggregatePayoutMetrics(reconciliationRecords);
  }, [reconciliationRecords]);

  useEffect(() => {
    fetchMetrics();
    // Refresh payouts every 30s to match bridge stats
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchAuditLogs = useCallback(async (page: number, action: string) => {
    setAuditLoading(true);
    setAuditError(null);

    try {
      const params = new URLSearchParams({
        page: String(page),
        action,
      });
      const response = await fetch(`/api/admin/audit-log?${params.toString()}`);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch admin audit logs (${response.status})`,
        );
      }

      const payload: AuditLogResponse = await response.json();
      setAuditEntries(payload.entries);
      setAuditActions(payload.actions);
      setAuditPage(payload.page);
      setAuditPageSize(payload.pageSize);
      setAuditTotal(payload.total);
      setAuditTotalPages(payload.totalPages);
    } catch (error) {
      setAuditError(
        error instanceof Error
          ? error.message
          : 'Failed to fetch admin audit logs',
      );
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuditLogs(auditPage, actionFilter);
  }, [fetchAuditLogs, auditPage, actionFilter]);

  const fetchMetrics = async () => {
    try {
      const response = await fetch('/api/admin/reconciliation');
      if (response.ok) {
        const records: ReconciliationRecord[] = await response.json();
        setReconciliationRecords(records);
        const dailyMetrics = aggregateDailyVolume(records, 30);
        setMetrics(dailyMetrics);
      }
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    } finally {
      setLoadingMetrics(false);
    }
  };

  const exportAuditToCSV = async () => {
    try {
      setExportingCsv(true);
      const allEntries: AdminAuditLogEntry[] = [];

      for (let page = 1; page <= auditTotalPages; page += 1) {
        const params = new URLSearchParams({
          page: String(page),
          action: actionFilter,
        });
        const response = await fetch(
          `/api/admin/audit-log?${params.toString()}`,
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch audit page ${page}`);
        }

        const payload: AuditLogResponse = await response.json();
        allEntries.push(...payload.entries);
      }

      const headers = [
        'Timestamp',
        'Action',
        'Admin Address',
        'Parameters',
        'Result',
      ];

      const csvRows = allEntries.map((entry) =>
        [
          entry.timestamp,
          formatActionLabel(entry.action),
          entry.adminAddress,
          formatParameters(entry.parameters),
          entry.result,
        ]
          .map((value) => escapeCsvValue(String(value)))
          .join(','),
      );

      const csvContent = [headers.join(','), ...csvRows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `admin_audit_log_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      setAuditError(
        error instanceof Error
          ? error.message
          : 'Failed to export audit log CSV',
      );
    } finally {
      setExportingCsv(false);
    }
  };

  const totalVolume = metrics.reduce((acc, curr) => acc + curr.volume, 0);
  const maxVolume = metrics.length
    ? Math.max(...metrics.map((d) => d.volume))
    : 0;

  if (loadingMetrics) {
    return (
      <div className="min-h-screen theme-app p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold theme-text-primary mb-8">
            Admin Dashboard
          </h1>
          <div className="text-center theme-text-muted">Loading metrics...</div>
        </div>
      </div>
    );
  }

  return (
    <AdminGuard>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Admin Dashboard
            </h1>
            {enableAdminReconciliation && (
              <Link
                href="/admin/reconciliation"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Reconciliation Tools
              </Link>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border-t-4 border-blue-500">
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">
                Bridge Balance
              </h2>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {balance !== null ? `${stroopsToDisplay(balance)} XLM` : '---'}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border-t-4 border-indigo-500">
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">
                Total Deposited
              </h2>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {totalDeposited !== null
                  ? `${stroopsToDisplay(totalDeposited)} XLM`
                  : '---'}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border-t-4 border-yellow-500">
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">
                Pending Payouts
              </h2>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {payoutMetrics.pendingPayouts}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border-t-4 border-red-500">
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">
                Failed Payouts
              </h2>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {payoutMetrics.failedPayouts}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-8">
            <div className="lg:col-span-8 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
                Daily Transaction Volume
              </h2>
              <div className="h-80 w-full relative">
                {maxVolume > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={metrics}
                      margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="colorVolume"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#3b82f6"
                            stopOpacity={0.8}
                          />
                          <stop
                            offset="95%"
                            stopColor="#3b82f6"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="date"
                        tickFormatter={(val) => {
                          const date = new Date(val);
                          return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af' }}
                      />
                      <YAxis
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af' }}
                        width={60}
                      />
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="#374151"
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1f2937',
                          borderColor: '#374151',
                          color: '#fff',
                        }}
                        itemStyle={{ color: '#60a5fa' }}
                        labelFormatter={(label) => `Date: ${label}`}
                      />
                      <Area
                        type="monotone"
                        dataKey="volume"
                        stroke="#3b82f6"
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#colorVolume)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                    <div className="text-gray-500 dark:text-gray-400 text-center">
                      <svg
                        className="mx-auto h-12 w-12 text-gray-400 mb-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                        />
                      </svg>
                      <p className="text-lg font-medium mb-1">
                        No transaction data available
                      </p>
                      <p className="text-sm">
                        Metrics chart will render here once deposits are logged.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-4 bg-white dark:bg-gray-800 rounded-lg shadow p-6 border-t-4 border-blue-500">
              <h2 className="text-lg font-medium text-gray-500 dark:text-gray-400 mb-2">
                30-Day Volume (XLM)
              </h2>
              <div className="text-4xl font-bold text-gray-900 dark:text-white">
                {totalVolume.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow mt-8 overflow-hidden">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Admin Audit Log
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Append-only timeline of administrative actions.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                  <div>
                    <label
                      htmlFor="audit-action-filter"
                      className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1"
                    >
                      Action Type
                    </label>
                    <select
                      id="audit-action-filter"
                      value={actionFilter}
                      onChange={(event) => {
                        setActionFilter(event.target.value);
                        setAuditPage(1);
                      }}
                      className="w-full sm:w-64 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                    >
                      <option value="all">All Actions</option>
                      {auditActions.map((action) => (
                        <option key={action} value={action}>
                          {formatActionLabel(action)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={exportAuditToCSV}
                    disabled={exportingCsv || auditLoading || auditTotal === 0}
                    className="h-10 mt-0 sm:mt-5 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:bg-emerald-300 disabled:cursor-not-allowed"
                  >
                    {exportingCsv ? 'Exporting...' : 'Export CSV'}
                  </button>
                </div>
              </div>
            </div>

            {auditError && (
              <div className="px-6 py-4 text-sm text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
                {auditError}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Timestamp
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Action
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Admin Address
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Parameters
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Result
                    </th>
                  </tr>
                </thead>

                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {!auditLoading &&
                    auditEntries.map((entry) => (
                      <tr
                        key={entry.id}
                        className="hover:bg-gray-50 dark:hover:bg-gray-700/40"
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">
                          {new Date(entry.timestamp).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-medium">
                          {formatActionLabel(entry.action)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-700 dark:text-gray-200">
                          {entry.adminAddress}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-200 max-w-xl">
                          <span className="inline-block bg-gray-100 dark:bg-gray-700 rounded px-2 py-1 break-all">
                            {formatParameters(entry.parameters)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span
                            className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${
                              entry.result === 'success'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                                : entry.result === 'failed'
                                  ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                                  : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
                            }`}
                          >
                            {entry.result}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {auditLoading && (
              <div className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                Loading audit entries...
              </div>
            )}

            {!auditLoading && auditEntries.length === 0 && (
              <div className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                No audit entries found for the selected action type.
              </div>
            )}

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Showing{' '}
                {(auditPage - 1) * auditPageSize +
                  (auditEntries.length ? 1 : 0)}
                -{(auditPage - 1) * auditPageSize + auditEntries.length} of{' '}
                {auditTotal}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setAuditPage((previous) => Math.max(previous - 1, 1))
                  }
                  disabled={auditPage <= 1 || auditLoading}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  Page {auditPage} of {auditTotalPages}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setAuditPage((previous) =>
                      Math.min(previous + 1, auditTotalPages),
                    )
                  }
                  disabled={auditPage >= auditTotalPages || auditLoading}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          {/* Audit Log Section */}
          <div className="mt-12">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              Audit Log
            </h2>
            <AuditTable />
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}
