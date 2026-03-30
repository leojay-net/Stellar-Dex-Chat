import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CCIPBridgeModal from '../CCIPBridgeModal';

vi.mock('@/hooks/useAccessibleModal', () => ({
  useAccessibleModal: () => undefined,
}));

describe('CCIPBridgeModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onStartTransfer: vi.fn().mockResolvedValue({
      transactionHash: '0xabc123',
    }),
    fetchTransferStatus: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('shows a polling spinner and message while waiting for confirmation', async () => {
    const fetchTransferStatus = vi
      .fn()
      .mockResolvedValueOnce({ status: 'PENDING' })
      .mockResolvedValueOnce({ status: 'PENDING' });

    render(
      <CCIPBridgeModal
        {...defaultProps}
        fetchTransferStatus={fetchTransferStatus}
      />,
    );

    fireEvent.click(screen.getByText('Start CCIP Transfer'));

    expect(
      await screen.findByText('Waiting for CCIP confirmation…'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('ccip-polling-spinner')).toBeInTheDocument();
    expect(fetchTransferStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });

    await waitFor(() => {
      expect(fetchTransferStatus).toHaveBeenCalledTimes(2);
    });
  });

  it('shows a green checkmark when the explorer reports SUCCESS', async () => {
    const fetchTransferStatus = vi.fn().mockResolvedValue({
      status: 'SUCCESS',
      explorerUrl: 'https://ccip.chain.link/status?search=0xabc123',
    });

    render(
      <CCIPBridgeModal
        {...defaultProps}
        fetchTransferStatus={fetchTransferStatus}
      />,
    );

    fireEvent.click(screen.getByText('Start CCIP Transfer'));

    expect(
      await screen.findByText('CCIP transfer confirmed'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('ccip-success-icon')).toBeInTheDocument();
    expect(screen.getByText('Status: SUCCESS')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /view transaction in ccip explorer/i }),
    ).toHaveAttribute(
      'href',
      'https://ccip.chain.link/status?search=0xabc123',
    );
  });

  it('times out after 10 minutes and shows an error state', async () => {
    const fetchTransferStatus = vi.fn().mockResolvedValue({ status: 'PENDING' });

    render(
      <CCIPBridgeModal
        {...defaultProps}
        fetchTransferStatus={fetchTransferStatus}
      />,
    );

    fireEvent.click(screen.getByText('Start CCIP Transfer'));

    expect(
      await screen.findByText('Waiting for CCIP confirmation…'),
    ).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(
      await screen.findByText('CCIP transfer error'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/timed out after 10 minutes/i),
    ).toBeInTheDocument();
  });
});
