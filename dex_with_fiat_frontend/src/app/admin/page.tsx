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
import { useEffect as useThemeEffect, useState as useThemeState } from 'react';

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

// Hook to get theme-aware colors for charts
function useChartColors() {
  const [colors, setColors] = useThemeState({
    primary: '#3b82f6',
    textMuted: '#9ca3af',
    border: '#374151',
    surface: '#1f2937',
    surfaceBorder: '#374151',
  });

  useThemeEffect(() => {
    const updateColors = () => {
      const root = document.documentElement;
      const computedStyle = getComputedStyle(root);

      setColors({
        primary:
          computedStyle.getPropertyValue('--color-primary').trim() || '#3b82f6',
        textMuted:
          computedStyle.getPropertyValue('--color-text-muted').trim() ||
          '#9ca3af',
        border:
          computedStyle.getPropertyValue('--color-border').trim() || '#374151',
        surface:
          computedStyle.getPropertyValue('--color-surface').trim() || '#1f2937',
        surfaceBorder:
          computedStyle.getPropertyValue('--color-border').trim() || '#374151',
      });
    };

    updateColors();

    // Listen for theme changes
    const observer = new MutationObserver(updateColors);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  return colors;
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
  const chartColors = useChartColors();

  const { balance, totalDeposited } = useBridgeStats();

  const payoutMetrics = useMemo(() => {
    return aggregatePayoutMetrics(reconciliationRecords);
  }, [reconciliationRecords]);

  useEffect(() => {
    fetchMetrics();
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
      <div className="min-h-screen theme-app p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold theme-text-primary">
              Admin Dashboard
            </h1>
            {enableAdminReconciliation && (
              <Link
                href="/admin/reconciliation"
                className="theme-primary-button px-4 py-2 rounded-md"
              >
                Reconciliation Tools
              </Link>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div
              className="theme-surface rounded-lg shadow p-6 border-t-4"
              style={{ borderTopColor: 'var(--color-primary)' }}
            >
              <h2 className="text-sm font-medium theme-text-secondary mb-2 uppercase tracking-wider">
                Bridge Balance
              </h2>
              <div className="text-2xl font-bold theme-text-primary">
                {balance !== null ? `${stroopsToDisplay(balance)} XLM` : '---'}
              </div>
            </div>

            <div
              className="theme-surface rounded-lg shadow p-6 border-t-4"
              style={{ borderTopColor: 'var(--color-primary)' }}
            >
              <h2 className="text-sm font-medium theme-text-secondary mb-2 uppercase tracking-wider">
                Total Deposited
              </h2>
              <div className="text-2xl font-bold theme-text-primary">
                {totalDeposited !== null
                  ? `${stroopsToDisplay(totalDeposited)} XLM`
                  : '---'}
              </div>
            </div>

            <div
              className="theme-surface rounded-lg shadow p-6 border-t-4"
              style={{ borderTopColor: 'var(--color-warning)' }}
            >
              <h2 className="text-sm font-medium theme-text-secondary mb-2 uppercase tracking-wider">
                Pending Payouts
              </h2>
              <div className="text-2xl font-bold theme-text-primary">
                {payoutMetrics.pendingPayouts}
              </div>
            </div>

            <div
              className="theme-surface rounded-lg shadow p-6 border-t-4"
              style={{ borderTopColor: 'var(--color-danger)' }}
            >
              <h2 className="text-sm font-medium theme-text-secondary mb-2 uppercase tracking-wider">
                Failed Payouts
              </h2>
              <div className="text-2xl font-bold theme-text-primary">
                {payoutMetrics.failedPayouts}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-8">
            <div className="lg:col-span-8 theme-surface rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold theme-text-primary mb-6">
                Daily Transaction Volume
              </h2>
              <div className="h-80 w-full relative" role="img" aria-label="Transaction volume chart showing volume over time in XLM">
                {maxVolume > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={metrics}
                      margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                      aria-hidden="true"
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
                            stopColor={chartColors.primary}
                            stopOpacity={0.8}
                          />
                          <stop
                            offset="95%"
                            stopColor={chartColors.primary}
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
                        stroke={chartColors.textMuted}
                        tick={{ fill: chartColors.textMuted }}
                      />
                      <YAxis
                        stroke={chartColors.textMuted}
                        tick={{ fill: chartColors.textMuted }}
                        width={60}
                      />
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke={chartColors.border}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: chartColors.surface,
                          borderColor: chartColors.surfaceBorder,
                          color: chartColors.textMuted,
                        }}
                        itemStyle={{ color: chartColors.primary }}
                        labelFormatter={(label) => `Date: ${label}`}
                      />
                      <Area
                        type="monotone"
                        dataKey="volume"
                        stroke={chartColors.primary}
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#colorVolume)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center border-2 border-dashed theme-border rounded-lg theme-surface-muted">
                    <div className="theme-text-muted text-center">
                      <svg
                        className="mx-auto h-12 w-12 mb-3"
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

            <div
              className="lg:col-span-4 theme-surface rounded-lg shadow p-6 border-t-4"
              style={{ borderTopColor: 'var(--color-primary)' }}
            >
              <h2 className="text-lg font-medium theme-text-secondary mb-2">
                30-Day Volume (XLM)
              </h2>
              <div className="text-4xl font-bold theme-text-primary" aria-label={`30-day transaction volume: ${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })} XLM`}>
                {totalVolume.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
          </div>

          <div className="theme-surface rounded-lg shadow mt-8 overflow-hidden">
            <div className="p-6 theme-border border-b">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold theme-text-primary">
                    Admin Audit Log
                  </h2>
                  <p className="text-sm theme-text-secondary mt-1">
                    Append-only timeline of administrative actions.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                  <div>
                    <label
                      htmlFor="audit-action-filter"
                      className="block text-xs font-medium theme-text-secondary mb-1"
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
                      className="w-full sm:w-64 px-3 py-2 rounded-md text-sm theme-input theme-border border"
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
                    className="h-10 mt-0 sm:mt-5 px-4 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: 'var(--color-success)',
                      color: '#fff',
                    }}
                    aria-label={exportingCsv ? 'Exporting audit log to CSV file' : 'Export audit log to CSV file'}
                    aria-describedby="audit-action-filter"
                  >
                    {exportingCsv ? 'Exporting...' : 'Export CSV'}
                  </button>
                </div>
              </div>
            </div>

            {auditError && (
              <div
                className="px-6 py-4 text-sm theme-border border-b"
                style={{
                  backgroundColor: 'var(--color-danger-soft)',
                  color: 'var(--color-danger)',
                }}
              >
                {auditError}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full" role="table" aria-label="Admin audit log entries">
                <thead className="theme-surface-muted">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold theme-text-secondary uppercase tracking-wider" scope="col">
                      Timestamp
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold theme-text-secondary uppercase tracking-wider" scope="col">
                      Action
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold theme-text-secondary uppercase tracking-wider" scope="col">
                      Admin Address
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold theme-text-secondary uppercase tracking-wider" scope="col">
                      Parameters
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold theme-text-secondary uppercase tracking-wider" scope="col">
                      Result
                    </th>
                  </tr>
                </thead>

                <tbody className="theme-surface">
                  {!auditLoading &&
                    auditEntries.map((entry) => (
                      <tr
                        key={entry.id}
                        className="theme-border border-b hover:opacity-80"
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm theme-text-primary">
                          {new Date(entry.timestamp).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm theme-text-primary font-medium">
                          {formatActionLabel(entry.action)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-mono theme-text-primary">
                          {entry.adminAddress}
                        </td>
                        <td className="px-6 py-4 text-sm theme-text-primary max-w-xl">
                          <span className="inline-block theme-surface-muted rounded px-2 py-1 break-all">
                            {formatParameters(entry.parameters)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span
                            className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${
                              entry.result === 'success'
                                ? 'theme-soft-success'
                                : entry.result === 'failed'
                                  ? 'theme-soft-danger'
                                  : 'theme-soft-warning'
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
              <div className="px-6 py-8 text-center text-sm theme-text-muted">
                Loading audit entries...
              </div>
            )}

            {!auditLoading && auditEntries.length === 0 && (
              <div className="px-6 py-8 text-center text-sm theme-text-muted">
                No audit entries found for the selected action type.
              </div>
            )}

            <div className="px-6 py-4 theme-border border-t flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-sm theme-text-secondary">
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
                  className="px-3 py-2 text-sm theme-border border rounded-md theme-text-primary theme-surface-muted hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label={`Go to previous page. Current page is ${auditPage} of ${auditTotalPages}`}
                >
                  Previous
                </button>
                <span className="text-sm theme-text-secondary" aria-live="polite" aria-atomic="true">
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
                  className="px-3 py-2 text-sm theme-border border rounded-md theme-text-primary theme-surface-muted hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label={`Go to next page. Current page is ${auditPage} of ${auditTotalPages}`}
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          {/* Audit Log Section */}
          <div className="mt-12">
            <h2 className="text-2xl font-bold theme-text-primary mb-6">
              Audit Log
            </h2>
            <AuditTable />
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}
