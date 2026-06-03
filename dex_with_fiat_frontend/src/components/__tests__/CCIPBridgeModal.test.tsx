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

  // ── Race condition regression tests (issue #520) ─────────────────────

  describe('Race condition fix (issue #520)', () => {
    it('does not call fetchTransferStatus after modal is closed mid-poll', async () => {
      let resolveStatus!: (v: { status: string }) => void;
      const fetchTransferStatus = vi.fn().mockImplementationOnce(
        () => new Promise((resolve) => { resolveStatus = resolve; }),
      );

      const { rerender } = render(
        <CCIPBridgeModal
          {...defaultProps}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));
      await screen.findByText('Waiting for CCIP confirmation…');

      // Close the modal while the first poll is still in-flight
      rerender(
        <CCIPBridgeModal
          {...defaultProps}
          isOpen={false}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      // Resolve the in-flight request after the modal closed
      await act(async () => {
        resolveStatus({ status: 'SUCCESS' });
      });

      // The modal is closed — success state must NOT be rendered
      expect(screen.queryByText('CCIP transfer confirmed')).not.toBeInTheDocument();
    });

    it('does not apply stale status from a previous hash after hash changes', async () => {
      // First call returns slowly; second call returns quickly with SUCCESS
      let resolveFirst!: (v: { status: string }) => void;
      const fetchTransferStatus = vi
        .fn()
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockResolvedValue({ status: 'SUCCESS' });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));
      await screen.findByText('Waiting for CCIP confirmation…');

      // Advance timer to trigger a second poll (which resolves to SUCCESS)
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });

      // Confirm success from the fast second poll
      await screen.findByText('CCIP transfer confirmed');

      // Now resolve the stale first poll — it should be a no-op
      await act(async () => {
        resolveFirst({ status: 'FAILED' });
      });

      // Should still show success, not error
      expect(screen.getByText('CCIP transfer confirmed')).toBeInTheDocument();
      expect(screen.queryByText('CCIP transfer error')).not.toBeInTheDocument();
    });
  });

  // ── Optimistic UI tests for issue #536 ────────────────────────────────

  describe('Optimistic UI updates (issue #536)', () => {
    it('immediately shows PENDING status when transfer is initiated', async () => {
      const onStartTransfer = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ transactionHash: '0xabc123' }),
              100,
            ),
          ),
      );

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onStartTransfer={onStartTransfer}
          fetchTransferStatus={vi.fn().mockResolvedValue({ status: 'PENDING' })}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      // Should show initiating state immediately
      expect(
        await screen.findByText('Starting CCIP transfer…'),
      ).toBeInTheDocument();

      // Wait for the transfer to complete
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // Should transition to polling with PENDING status
      expect(
        await screen.findByText('Waiting for CCIP confirmation…'),
      ).toBeInTheDocument();
      expect(screen.getByText('Latest status: PENDING')).toBeInTheDocument();
    });

    it('immediately transitions to polling state after successful transfer initiation', async () => {
      const onStartTransfer = vi.fn().mockResolvedValue({
        transactionHash: '0xabc123',
        explorerUrl: 'https://ccip.chain.link/status?search=0xabc123',
      });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onStartTransfer={onStartTransfer}
          fetchTransferStatus={vi.fn().mockResolvedValue({ status: 'PENDING' })}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      // Should immediately show polling state with explorer link
      expect(
        await screen.findByText('Waiting for CCIP confirmation…'),
      ).toBeInTheDocument();
      
      const explorerLink = screen.getByRole('link', {
        name: /view transaction in ccip explorer/i,
      });
      expect(explorerLink).toHaveAttribute(
        'href',
        'https://ccip.chain.link/status?search=0xabc123',
      );
    });

    it('immediately updates status when polling receives new status', async () => {
      const fetchTransferStatus = vi
        .fn()
        .mockResolvedValueOnce({ status: 'PENDING' })
        .mockResolvedValueOnce({ status: 'IN_PROGRESS' })
        .mockResolvedValueOnce({ status: 'SUCCESS' });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      // Initial PENDING status
      expect(
        await screen.findByText('Latest status: PENDING'),
      ).toBeInTheDocument();

      // Advance to next poll
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });

      // Should immediately show IN_PROGRESS
      expect(
        await screen.findByText('Latest status: IN_PROGRESS'),
      ).toBeInTheDocument();

      // Advance to final poll
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });

      // Should immediately transition to success
      expect(
        await screen.findByText('CCIP transfer confirmed'),
      ).toBeInTheDocument();
    });

    it('immediately transitions to success state when SUCCESS status is received', async () => {
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

      // Should immediately transition to success
      expect(
        await screen.findByText('CCIP transfer confirmed'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('ccip-success-icon')).toBeInTheDocument();
    });

    it('immediately transitions to error state when FAILED status is received', async () => {
      const fetchTransferStatus = vi.fn().mockResolvedValue({
        status: 'FAILED',
        errorMessage: 'Insufficient funds',
      });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      // Should immediately transition to error
      expect(
        await screen.findByText('CCIP transfer error'),
      ).toBeInTheDocument();
      expect(screen.getByText('Insufficient funds')).toBeInTheDocument();
    });

    it('rolls back optimistic updates when transfer initiation fails', async () => {
      const onStartTransfer = vi
        .fn()
        .mockRejectedValue(new Error('Network error'));

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onStartTransfer={onStartTransfer}
          fetchTransferStatus={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      // Should show error state
      expect(
        await screen.findByText('CCIP transfer error'),
      ).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();

      // Should not show any transaction details
      expect(screen.queryByText(/Transaction:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Latest status:/)).not.toBeInTheDocument();
    });

    it('maintains PENDING status during transient polling errors', async () => {
      const fetchTransferStatus = vi
        .fn()
        .mockResolvedValueOnce({ status: 'PENDING' })
        .mockRejectedValueOnce(new Error('Temporary network error'))
        .mockResolvedValueOnce({ status: 'SUCCESS' });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      // Initial PENDING status
      expect(
        await screen.findByText('Latest status: PENDING'),
      ).toBeInTheDocument();

      // Advance to next poll (which will fail)
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });

      // Should maintain PENDING status and polling state
      expect(screen.getByText('Latest status: PENDING')).toBeInTheDocument();
      expect(
        screen.getByText('Waiting for CCIP confirmation…'),
      ).toBeInTheDocument();

      // Advance to final poll (which will succeed)
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });

      // Should transition to success
      expect(
        await screen.findByText('CCIP transfer confirmed'),
      ).toBeInTheDocument();
    });

    it('immediately shows explorer URL for better user experience', async () => {
      const onStartTransfer = vi.fn().mockResolvedValue({
        transactionHash: '0xdef456',
      });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onStartTransfer={onStartTransfer}
          fetchTransferStatus={vi.fn().mockResolvedValue({ status: 'PENDING' })}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      // Explorer link should be available immediately after initiation
      const explorerLink = await screen.findByRole('link', {
        name: /view transaction in ccip explorer/i,
      });
      
      expect(explorerLink).toBeInTheDocument();
      expect(explorerLink).toHaveAttribute(
        'href',
        expect.stringContaining('0xdef456'),
      );
    });
  });

  // ── Modal open/close and state reset tests ────────────────────────────────

  describe('Modal open/close behavior', () => {
    it('renders null when modal is closed', () => {
      const { container } = render(
        <CCIPBridgeModal
          {...defaultProps}
          isOpen={false}
        />,
      );

      expect(container.firstChild).toBeNull();
    });

    it('resets state when modal is closed after successful transfer', async () => {
      const fetchTransferStatus = vi.fn().mockResolvedValue({
        status: 'SUCCESS',
      });

      const { rerender } = render(
        <CCIPBridgeModal
          {...defaultProps}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));
      await screen.findByText('CCIP transfer confirmed');

      // Close the modal
      rerender(
        <CCIPBridgeModal
          {...defaultProps}
          isOpen={false}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      // Reopen the modal
      rerender(
        <CCIPBridgeModal
          {...defaultProps}
          isOpen={true}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      // Should be back in idle state
      expect(screen.getByText('Start CCIP Transfer')).toBeInTheDocument();
      expect(screen.queryByText('CCIP transfer confirmed')).not.toBeInTheDocument();
      expect(screen.queryByText('CCIP transfer error')).not.toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onClose={onClose}
        />,
      );

      const closeButton = screen.getByLabelText('Close');
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('has proper ARIA attributes for accessibility', () => {
      render(
        <CCIPBridgeModal
          {...defaultProps}
        />,
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-label', 'CCIP bridge transfer');
      expect(dialog).toHaveAttribute('tabIndex', '-1');
    });
  });

  // ── Custom configuration tests ─────────────────────────────────────────────

  describe('Custom pollIntervalMs and timeoutMs', () => {
    it('uses custom pollIntervalMs for polling', async () => {
      const fetchTransferStatus = vi
        .fn()
        .mockResolvedValueOnce({ status: 'PENDING' })
        .mockResolvedValueOnce({ status: 'SUCCESS' });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          pollIntervalMs={5000}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));
      await screen.findByText('Waiting for CCIP confirmation…');

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      await waitFor(() => {
        expect(fetchTransferStatus).toHaveBeenCalledTimes(2);
      });
    });

    it('uses custom timeoutMs for timeout behavior', async () => {
      const fetchTransferStatus = vi.fn().mockResolvedValue({ status: 'PENDING' });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          timeoutMs={30000}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));
      await screen.findByText('Waiting for CCIP confirmation…');

      await act(async () => {
        vi.advanceTimersByTime(30000);
      });

      expect(
        await screen.findByText('CCIP transfer error'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/timed out after 10 minutes/i),
      ).toBeInTheDocument();
    });
  });

  // ── Error handling tests ───────────────────────────────────────────────────

  describe('Error handling edge cases', () => {
    it('handles empty transaction hash error', async () => {
      const onStartTransfer = vi.fn().mockResolvedValue({
        transactionHash: '',
      });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onStartTransfer={onStartTransfer}
          fetchTransferStatus={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      expect(
        await screen.findByText('CCIP transfer error'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('CCIP transfer did not return a transaction hash.'),
      ).toBeInTheDocument();
    });

    it('handles whitespace-only transaction hash error', async () => {
      const onStartTransfer = vi.fn().mockResolvedValue({
        transactionHash: '   ',
      });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onStartTransfer={onStartTransfer}
          fetchTransferStatus={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      expect(
        await screen.findByText('CCIP transfer error'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('CCIP transfer did not return a transaction hash.'),
      ).toBeInTheDocument();
    });

    it('handles ERROR status from API', async () => {
      const fetchTransferStatus = vi.fn().mockResolvedValue({
        status: 'ERROR',
        errorMessage: 'Transaction reverted',
      });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      expect(
        await screen.findByText('CCIP transfer error'),
      ).toBeInTheDocument();
      expect(screen.getByText('Transaction reverted')).toBeInTheDocument();
    });

    it('handles FAILED status without errorMessage', async () => {
      const fetchTransferStatus = vi.fn().mockResolvedValue({
        status: 'FAILED',
      });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      expect(
        await screen.findByText('CCIP transfer error'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/CCIP transfer failed with status "FAILED"/),
      ).toBeInTheDocument();
    });

    it('handles non-Error objects in error state', async () => {
      const onStartTransfer = vi.fn().mockRejectedValue('String error');

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onStartTransfer={onStartTransfer}
          fetchTransferStatus={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      expect(
        await screen.findByText('CCIP transfer error'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Unable to start the CCIP transfer.'),
      ).toBeInTheDocument();
    });

    it('handles null error in error state', async () => {
      const onStartTransfer = vi.fn().mockRejectedValue(null);

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onStartTransfer={onStartTransfer}
          fetchTransferStatus={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      expect(
        await screen.findByText('CCIP transfer error'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Unable to start the CCIP transfer.'),
      ).toBeInTheDocument();
    });
  });

  // ── Transaction hash display tests ───────────────────────────────────────

  describe('Transaction hash display', () => {
    it('displays transaction hash in polling state', async () => {
      const onStartTransfer = vi.fn().mockResolvedValue({
        transactionHash: '0xabc123def456',
      });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onStartTransfer={onStartTransfer}
          fetchTransferStatus={vi.fn().mockResolvedValue({ status: 'PENDING' })}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      expect(
        await screen.findByText('Transaction: 0xabc123def456'),
      ).toBeInTheDocument();
    });

    it('displays transaction hash in success state', async () => {
      const onStartTransfer = vi.fn().mockResolvedValue({
        transactionHash: '0xxyz789',
      });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onStartTransfer={onStartTransfer}
          fetchTransferStatus={vi.fn().mockResolvedValue({ status: 'SUCCESS' })}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      await screen.findByText('CCIP transfer confirmed');
      expect(
        screen.getByText('Transaction: 0xxyz789'),
      ).toBeInTheDocument();
    });

    it('displays transaction hash in error state when available', async () => {
      const onStartTransfer = vi.fn().mockResolvedValue({
        transactionHash: '0xerror123',
      });

      const fetchTransferStatus = vi.fn().mockResolvedValue({
        status: 'FAILED',
        errorMessage: 'Transfer failed',
      });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onStartTransfer={onStartTransfer}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      await screen.findByText('CCIP transfer error');
      expect(
        screen.getByText('Transaction: 0xerror123'),
      ).toBeInTheDocument();
    });
  });

  // ── Rapid click prevention tests ──────────────────────────────────────────

  describe('Rapid click prevention', () => {
    it('prevents multiple simultaneous transfer initiations', async () => {
      let resolveTransfer!: (v: { transactionHash: string }) => void;
      const onStartTransfer = vi.fn().mockImplementation(
        () => new Promise((resolve) => { resolveTransfer = resolve; }),
      );

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onStartTransfer={onStartTransfer}
          fetchTransferStatus={vi.fn().mockResolvedValue({ status: 'PENDING' })}
        />,
      );

      const startButton = screen.getByText('Start CCIP Transfer');

      // First click
      fireEvent.click(startButton);
      expect(onStartTransfer).toHaveBeenCalledTimes(1);

      // Rapid second click while first is in progress
      fireEvent.click(startButton);
      expect(onStartTransfer).toHaveBeenCalledTimes(1);

      // Resolve the transfer
      await act(async () => {
        resolveTransfer({ transactionHash: '0xabc123' });
      });

      await screen.findByText('Waiting for CCIP confirmation…');
    });

    it('handles clicks after error state', async () => {
      const onStartTransfer = vi
        .fn()
        .mockRejectedValueOnce(new Error('First error'))
        .mockResolvedValueOnce({ transactionHash: '0xabc123' });

      const fetchTransferStatus = vi.fn().mockResolvedValue({ status: 'SUCCESS' });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onStartTransfer={onStartTransfer}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      // First attempt fails
      fireEvent.click(screen.getByText('Start CCIP Transfer'));
      await screen.findByText('CCIP transfer error');

      // User must close and reopen to try again (current behavior)
      // This test documents the current behavior
      expect(screen.queryByText('Start CCIP Transfer')).not.toBeInTheDocument();
    });
  });

  // ── Explorer URL fallback tests ───────────────────────────────────────────

  describe('Explorer URL fallback', () => {
    it('uses provided explorerUrl from transfer result', async () => {
      const onStartTransfer = vi.fn().mockResolvedValue({
        transactionHash: '0xabc123',
        explorerUrl: 'https://custom-explorer.example.com/tx/0xabc123',
      });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onStartTransfer={onStartTransfer}
          fetchTransferStatus={vi.fn().mockResolvedValue({ status: 'PENDING' })}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      const explorerLink = await screen.findByRole('link', {
        name: /view transaction in ccip explorer/i,
      });

      expect(explorerLink).toHaveAttribute(
        'href',
        'https://custom-explorer.example.com/tx/0xabc123',
      );
    });

    it('updates explorer URL when provided in status response', async () => {
      const fetchTransferStatus = vi
        .fn()
        .mockResolvedValueOnce({ status: 'PENDING' })
        .mockResolvedValueOnce({
          status: 'SUCCESS',
          explorerUrl: 'https://updated-explorer.example.com/tx/0xabc123',
        });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });

      const explorerLink = screen.getByRole('link', {
        name: /view transaction in ccip explorer/i,
      });

      expect(explorerLink).toHaveAttribute(
        'href',
        'https://updated-explorer.example.com/tx/0xabc123',
      );
    });
  });

  // ── State transition tests ────────────────────────────────────────────────

  describe('State transitions', () => {
    it('transitions from idle to optimistic on start', async () => {
      let resolveTransfer!: (v: { transactionHash: string }) => void;
      const onStartTransfer = vi.fn().mockImplementation(
        () => new Promise((resolve) => { resolveTransfer = resolve; }),
      );

      render(
        <CCIPBridgeModal
          {...defaultProps}
          onStartTransfer={onStartTransfer}
          fetchTransferStatus={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      expect(
        await screen.findByText('Transfer Initiated!'),
      ).toBeInTheDocument();

      await act(async () => {
        resolveTransfer({ transactionHash: '0xabc123' });
      });
    });

    it('shows all status messages in polling state', async () => {
      const fetchTransferStatus = vi
        .fn()
        .mockResolvedValueOnce({ status: 'PENDING' })
        .mockResolvedValueOnce({ status: 'IN_PROGRESS' })
        .mockResolvedValueOnce({ status: 'COMPLETING' })
        .mockResolvedValueOnce({ status: 'SUCCESS' });

      render(
        <CCIPBridgeModal
          {...defaultProps}
          fetchTransferStatus={fetchTransferStatus}
        />,
      );

      fireEvent.click(screen.getByText('Start CCIP Transfer'));

      expect(
        await screen.findByText('Latest status: PENDING'),
      ).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
      expect(screen.getByText('Latest status: IN_PROGRESS')).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
      expect(screen.getByText('Latest status: COMPLETING')).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
      expect(screen.getByText('CCIP transfer confirmed')).toBeInTheDocument();
    });
  });
});
