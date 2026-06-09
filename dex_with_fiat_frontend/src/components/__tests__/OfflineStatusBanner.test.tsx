import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import OfflineStatusBanner from '../OfflineStatusBanner';

// Mock the hooks
const mockAddToast = vi.fn();
const mockResetWasOffline = vi.fn();

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: vi.fn(),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

import { useOnlineStatus } from '@/hooks/useOnlineStatus';

describe('OfflineStatusBanner', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders nothing when online', () => {
    vi.mocked(useOnlineStatus).mockReturnValue({
      isOnline: true,
      wasOffline: false,
      resetWasOffline: mockResetWasOffline,
    });

    render(<OfflineStatusBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders banner when offline', () => {
    vi.mocked(useOnlineStatus).mockReturnValue({
      isOnline: false,
      wasOffline: false,
      resetWasOffline: mockResetWasOffline,
    });

    render(<OfflineStatusBanner />);
    const banner = screen.getByRole('status');
    expect(banner).toBeDefined();
    expect(screen.getByText(/You are offline/i)).toBeDefined();
  });

  it('uses CSS variable tokens for colour — no raw Tailwind colour classes', () => {
    vi.mocked(useOnlineStatus).mockReturnValue({
      isOnline: false,
      wasOffline: false,
      resetWasOffline: mockResetWasOffline,
    });

    render(<OfflineStatusBanner />);
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/\bbg-red-\d+\b/);
    expect(html).not.toMatch(/\btext-red-\d+\b/);
    expect(html).not.toMatch(/\bborder-red-\d+\b/);
  });

  it('marks decorative icons as aria-hidden', () => {
    vi.mocked(useOnlineStatus).mockReturnValue({
      isOnline: false,
      wasOffline: false,
      resetWasOffline: mockResetWasOffline,
    });

    render(<OfflineStatusBanner />);
    const hiddenContainers = document.querySelectorAll('[aria-hidden="true"]');
    expect(hiddenContainers.length).toBeGreaterThanOrEqual(2);
  });

  it('exposes an accessible label on the banner region', () => {
    vi.mocked(useOnlineStatus).mockReturnValue({
      isOnline: false,
      wasOffline: false,
      resetWasOffline: mockResetWasOffline,
    });

    render(<OfflineStatusBanner />);
    expect(screen.getByLabelText(/offline status/i)).toBeDefined();
  });

  it('shows success toast when coming back online', () => {
    vi.mocked(useOnlineStatus).mockReturnValue({
      isOnline: true,
      wasOffline: true,
      resetWasOffline: mockResetWasOffline,
    });

    render(<OfflineStatusBanner />);
    
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('restored'),
      severity: 'success',
    }));
    expect(mockResetWasOffline).toHaveBeenCalled();
  });

  it('falls back to default message when toast validation fails', async () => {
    // Mock safeParse to return failure
    const { offlineStatusToastSchema } = await import('@/lib/offlineStatusSchema');
    const originalSafeParse = offlineStatusToastSchema.safeParse;
    offlineStatusToastSchema.safeParse = vi.fn().mockReturnValue({
      success: false,
      error: {
        issues: [{ message: 'Validation failed' }],
        format: () => ({}),
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useOnlineStatus as any).mockReturnValue({
      isOnline: true,
      wasOffline: true,
      resetWasOffline: mockResetWasOffline,
    });

    render(<OfflineStatusBanner />);
    
    expect(mockAddToast).toHaveBeenCalledWith('Validation failed');
    
    // Restore original
    offlineStatusToastSchema.safeParse = originalSafeParse;
  });
});
