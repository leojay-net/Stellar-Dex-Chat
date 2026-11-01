'use client';

import { useEffect, useState } from 'react';
import CCIPBridgeModal from '@/components/CCIPBridgeModal';
import type {
  CCIPStatusResult,
  CCIPTransferStartResult,
} from '@/lib/ccipExplorer';

export default function TestCCIPBridgeModalPage() {
  const [isOpen, setIsOpen] = useState(true);
  const [transferMode, setTransferMode] = useState<
    'success' | 'error' | 'timeout' | 'polling' | 'pending'
  >('success');
  const [network, setNetwork] = useState<string>('ethereum');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    if (
      mode === 'error' ||
      mode === 'timeout' ||
      mode === 'polling' ||
      mode === 'pending'
    ) {
      setTransferMode(mode);
    }
    const networkParam = params.get('network');
    if (networkParam) {
      setNetwork(networkParam);
    }
  }, []);

  const handleStartTransfer = async (): Promise<CCIPTransferStartResult> => {
    // Simulate transfer initiation
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (transferMode === 'error') {
      throw new Error('Failed to initiate CCIP transfer');
    }

    return {
      transactionHash: '0xabc123def456',
      explorerUrl: 'https://ccip.chain.link/status?search=0xabc123def456',
    };
  };

  const handleFetchStatus = async (
    transactionHash: string,
  ): Promise<CCIPStatusResult> => {
    // Simulate status fetch delay
    await new Promise((resolve) => setTimeout(resolve, 300));

    if (transferMode === 'success') {
      return {
        status: 'SUCCESS',
        explorerUrl: `https://ccip.chain.link/status?search=${transactionHash}`,
      };
    }

    if (transferMode === 'error') {
      return {
        status: 'FAILED',
        errorMessage: 'CCIP transfer failed due to insufficient gas',
        explorerUrl: `https://ccip.chain.link/status?search=${transactionHash}`,
      };
    }

    if (transferMode === 'timeout') {
      // Keep returning PENDING to trigger timeout
      return {
        status: 'PENDING',
        explorerUrl: `https://ccip.chain.link/status?search=${transactionHash}`,
      };
    }

    if (transferMode === 'pending') {
      return {
        status: 'PENDING',
        explorerUrl: `https://ccip.chain.link/status?search=${transactionHash}`,
      };
    }

    // Default: polling mode (PENDING then SUCCESS)
    return {
      status: 'PENDING',
      explorerUrl: `https://ccip.chain.link/status?search=${transactionHash}`,
    };
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 p-8">
      <div className="max-w-2xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          CCIP Bridge Modal Test Page
        </h1>
        <div className="space-y-2">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Current mode: <span className="font-semibold">{transferMode}</span>
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Current network: <span className="font-semibold">{network}</span>
          </p>
        </div>
        <div className="space-x-2">
          <button
            onClick={() => setIsOpen(true)}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Open Modal
          </button>
          <button
            onClick={() => setTransferMode('success')}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 text-sm"
          >
            Success Mode
          </button>
          <button
            onClick={() => setTransferMode('error')}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
          >
            Error Mode
          </button>
          <button
            onClick={() => setTransferMode('pending')}
            className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600 text-sm"
          >
            Pending Mode
          </button>
        </div>
      </div>

      <CCIPBridgeModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onStartTransfer={handleStartTransfer}
        fetchTransferStatus={handleFetchStatus}
        pollIntervalMs={transferMode === 'timeout' ? 100 : 1000}
        timeoutMs={transferMode === 'timeout' ? 2000 : 60000}
        network={network}
      />
    </div>
  );
}
