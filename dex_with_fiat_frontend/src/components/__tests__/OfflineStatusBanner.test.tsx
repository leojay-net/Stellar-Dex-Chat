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
    (useOnlineStatus as any).mockReturnValue({
      isOnline: true,
      wasOffline: false,
      resetWasOffline: mockResetWasOffline,
    });

    render(<OfflineStatusBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders banner when offline', () => {
    (useOnlineStatus as any).mockReturnValue({
      isOnline: false,
      wasOffline: false,
      resetWasOffline: mockResetWasOffline,
    });

    render(<OfflineStatusBanner />);
    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByText(/You are offline/i)).toBeDefined();
  });

  it('shows success toast when coming back online', () => {
    (useOnlineStatus as any).mockReturnValue({
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

  it('falls back to default message when toast validation fails', () => {
    // Mock safeParse to return failure
    const { offlineStatusToastSchema } = require('@/lib/offlineStatusSchema');
    const originalSafeParse = offlineStatusToastSchema.safeParse;
    offlineStatusToastSchema.safeParse = vi.fn().mockReturnValue({
      success: false,
      error: {
        issues: [{ message: 'Validation failed' }],
        format: () => ({}),
      },
    });

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
