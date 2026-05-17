import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useBridgeStats from '../useBridgeStats';

const stellarContractMocks = vi.hoisted(() => ({
  clearCache: vi.fn(),
  getBridgeLimit: vi.fn(),
  getContractBalance: vi.fn(),
  getTotalDeposited: vi.fn(),
}));

const telemetryMocks = vi.hoisted(() => ({
  bridgeStatsFetch: vi.fn(),
}));

vi.mock('@/lib/stellarContract', () => stellarContractMocks);

vi.mock('@/lib/chatTelemetry', () => ({
  chatTelemetry: telemetryMocks,
}));

describe('useBridgeStats telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stellarContractMocks.getContractBalance.mockResolvedValue(100n);
    stellarContractMocks.getBridgeLimit.mockResolvedValue(500n);
    stellarContractMocks.getTotalDeposited.mockResolvedValue(250n);
  });

  it('tracks successful automatic bridge stats fetches', async () => {
    const { result, unmount } = renderHook(() => useBridgeStats());

    await waitFor(() => {
      expect(result.current.balance).toBe(100n);
      expect(result.current.limit).toBe(500n);
      expect(result.current.totalDeposited).toBe(250n);
    });

    expect(telemetryMocks.bridgeStatsFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'auto',
        success: true,
        hasBalance: true,
        hasLimit: true,
        hasTotalDeposited: true,
      }),
    );
    expect(
      telemetryMocks.bridgeStatsFetch.mock.calls[0][0].durationMs,
    ).toBeGreaterThanOrEqual(0);

    unmount();
  });

  it('tracks failed automatic fetches without throwing', async () => {
    stellarContractMocks.getContractBalance.mockRejectedValueOnce(
      new Error('balance unavailable'),
    );

    const { result, unmount } = renderHook(() => useBridgeStats());

    await waitFor(() => {
      expect(result.current.error).toBe('balance unavailable');
    });

    expect(telemetryMocks.bridgeStatsFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'auto',
        success: false,
        hasBalance: false,
        hasLimit: false,
        hasTotalDeposited: false,
        errorMessage: 'balance unavailable',
      }),
    );

    unmount();
  });

  it('tracks manual refreshes after clearing the stats cache', async () => {
    const { result, unmount } = renderHook(() => useBridgeStats());

    await waitFor(() => {
      expect(telemetryMocks.bridgeStatsFetch).toHaveBeenCalledTimes(1);
    });

    stellarContractMocks.getContractBalance.mockResolvedValueOnce(125n);
    stellarContractMocks.getBridgeLimit.mockResolvedValueOnce(600n);
    stellarContractMocks.getTotalDeposited.mockResolvedValueOnce(300n);

    await act(async () => {
      await result.current.refresh();
    });

    expect(stellarContractMocks.clearCache).toHaveBeenCalledTimes(1);
    expect(result.current.balance).toBe(125n);
    expect(result.current.limit).toBe(600n);
    expect(result.current.totalDeposited).toBe(300n);
    expect(telemetryMocks.bridgeStatsFetch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: 'manual',
        success: true,
        hasBalance: true,
        hasLimit: true,
        hasTotalDeposited: true,
      }),
    );

    unmount();
  });

  it('keeps stats updates working when telemetry throws', async () => {
    telemetryMocks.bridgeStatsFetch.mockImplementationOnce(() => {
      throw new Error('telemetry adapter failed');
    });

    const { result, unmount } = renderHook(() => useBridgeStats());

    await waitFor(() => {
      expect(result.current.balance).toBe(100n);
      expect(result.current.error).toBeNull();
    });

    unmount();
  });
});
