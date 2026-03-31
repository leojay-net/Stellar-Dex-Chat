'use client';

import { useState, useEffect, useCallback } from 'react';
import { ReconciliationRecord } from '../../../types';

export default function ReconciliationDashboard() {
  const [records, setRecords] = useState<ReconciliationRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<
    ReconciliationRecord[]
  >([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReconciliationData();
  }, []);

  const fetchReconciliationData = async () => {
    try {
      const response = await fetch('/api/admin/reconciliation');
      if (response.ok) {
        const data = await response.json();
        setRecords(data);
      } else {
        console.error('Failed to fetch data');
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterRecords = useCallback(() => {
    let filtered = records;

    if (statusFilter !== 'all') {
      filtered = filtered.filter((record) => record.status === statusFilter);
    }

    if (startDate) {
      filtered = filtered.filter(
        (record) => new Date(record.depositDate) >= new Date(startDate),
      );
    }

    if (endDate) {
      filtered = filtered.filter(
        (record) => new Date(record.depositDate) <= new Date(endDate),
      );
    }

    setFilteredRecords(filtered);
  }, [records, statusFilter, startDate, endDate]);

  useEffect(() => {
    filterRecords();
  }, [filterRecords]);

  const exportToCSV = () => {
    const headers = [
      'ID',
      'Deposit TX Hash',
      'Deposit Amount',
      'Deposit User',
      'Deposit Date',
      'Payout ID',
      'Payout Amount',
      'Payout Recipient',
      'Payout Status',
      'Payout Date',
      'Status',
    ];

    const csvContent = [
      headers.join(','),
      ...filteredRecords.map((record) =>
        [
          record.id,
          record.depositTxHash,
          record.depositAmount,
          record.depositUser,
          record.depositDate,
          record.payoutId,
          record.payoutAmount,
          record.payoutRecipient,
          record.payoutStatus,
          record.payoutDate,
          record.status,
        ].join(','),
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `reconciliation_${new Date().toISOString().split('T')[0]}.csv`,
    );
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
            Admin Reconciliation Dashboard
          </h1>
          <div className="text-center">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
          Admin Reconciliation Dashboard
        </h1>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              >
                <option value="all">All</option>
                <option value="matched">Matched</option>
                <option value="unmatched">Unmatched</option>
                <option value="error">Error</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={exportToCSV}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Export CSV
              </button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Deposit
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Payout
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {filteredRecords.map((record) => (
                  <tr
                    key={record.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 dark:text-white">
                        <div className="font-medium">
                          {record.depositAmount} XLM
                        </div>
                        <div className="text-gray-500 dark:text-gray-400">
                          {record.depositTxHash.slice(0, 10)}...
                        </div>
                        <div className="text-gray-500 dark:text-gray-400">
                          {new Date(record.depositDate).toLocaleDateString()}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {record.payoutId ? (
                          <>
                            <div className="font-medium">
                              {record.payoutAmount}{' '}
                              {record.payoutStatus === 'completed' ? 'NGN' : ''}
                            </div>
                            <div className="text-gray-500 dark:text-gray-400">
                              {record.payoutId}
                            </div>
                            <div className="text-gray-500 dark:text-gray-400">
                              {record.payoutRecipient}
                            </div>
                          </>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">
                            No payout
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          record.status === 'matched'
                            ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-200'
                            : record.status === 'unmatched'
                              ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200'
                              : 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-200'
                        }`}
                      >
                        {record.status}
                      </span>
                      {record.payoutId && (
                        <div className="mt-1">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              record.payoutStatus === 'completed'
                                ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-200'
                                : record.payoutStatus === 'pending'
                                  ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200'
                                  : 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-200'
                            }`}
                          >
                            {record.payoutStatus}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredRecords.length === 0 && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              No records found matching the filters.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
