import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ToastProvider } from '../ToastProvider';
import { toastStore } from '@/lib/toastStore';

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

describe('ToastProvider', () => {
  beforeEach(() => {
    toastStore.clearToasts();
  });

  it('renders a polite live region for toast announcements', () => {
    act(() => {
      toastStore.addToast('Saved successfully', 'success');
    });

    render(
      <ToastProvider>
        <div>children</div>
      </ToastProvider>,
    );

    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByText('Saved successfully')).toBeTruthy();
  });
});
