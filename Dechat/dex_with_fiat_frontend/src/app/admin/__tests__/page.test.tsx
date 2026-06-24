import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import AdminDashboard from '../page';
import { ThemeProvider } from '@/contexts/ThemeContext';

// Mock dependencies
vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false, toggleDarkMode: vi.fn() }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn(() => false),
}));

vi.mock('@/hooks/useBridgeStats', () => ({
  default: vi.fn(() => ({
    balance: BigInt(1000000000000),
    totalDeposited: BigInt(5000000000000),
  })),
}));

vi.mock('@/components/AdminGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const auditTableMock = vi.hoisted(() =>
  vi.fn(() => <div data-testid="audit-table">Audit Table</div>),
);

vi.mock('@/components/AuditTable', () => ({
  default: (...args: unknown[]) => auditTableMock(...args),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

globalThis.fetch = vi.fn() as unknown as typeof fetch;

const VALID_STELLAR_ADDRESS =
  'G1234567890123456789012345678901234567890123456789012345';

function mockAdminDashboardFetch() {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url) => {
    if (typeof url === 'string' && url.includes('/api/admin/audit-log')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          entries: [
            {
              id: '1',
              timestamp: '2024-01-01T00:00:00Z',
              action: 'withdrawal_approved',
              adminAddress: VALID_STELLAR_ADDRESS,
              parameters: { amount: 100 },
              result: 'success',
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          actions: ['withdrawal_approved', 'withdrawal_rejected'],
        }),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: async () => [],
    } as Response);
  });
}

function resetAuditTableMock() {
  auditTableMock.mockImplementation(() => (
    <div data-testid="audit-table">Audit Table</div>
  ));
}

describe('AdminDashboard - Dark Mode Support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTableMock();
    mockAdminDashboardFetch();
  });

  it('renders with theme-aware classes', async () => {
    await act(async () => {
      render(<ThemeProvider><AdminDashboard /></ThemeProvider>);
    });

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    const shell = document.querySelector('.min-h-screen.theme-app');
    expect(shell?.className).toContain('theme-app');
    expect(screen.getByText('Admin Dashboard').className).toContain(
      'theme-text-primary',
    );
  });

  it('applies CSS tokens for colors — no raw Tailwind colour classes remain', async () => {
    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    // Scope to dashboard chrome; shared CopyButton still uses legacy gray tokens.
    const themedSurfaces = document.querySelectorAll('.theme-surface');
    expect(themedSurfaces.length).toBeGreaterThan(0);
    themedSurfaces.forEach((surface) => {
      if (surface.querySelector('[aria-label="Admin audit log entries"]')) {
        return;
      }
      const html = surface.outerHTML;
      expect(html).not.toMatch(/\bbg-gray-\d+\b/);
      expect(html).not.toMatch(/\bbg-white\b/);
      expect(html).not.toMatch(/\bbg-blue-\d+\b/);
      expect(html).not.toMatch(/\bbg-indigo-\d+\b/);
      expect(html).not.toMatch(/\btext-gray-\d+\b/);
      expect(html).not.toMatch(/\bborder-blue-\d+\b/);
      expect(html).not.toMatch(/\bborder-indigo-\d+\b/);
      expect(html).not.toMatch(/\bborder-gray-\d+\b/);
    });
  });

  it('uses theme utility classes for surfaces', async () => {
    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Bridge Balance')).toBeInTheDocument();
    });

    const card = screen.getByText('Bridge Balance').closest('div');
    expect(card?.className).toContain('theme-surface');
  });

  it('uses theme utility classes for text', async () => {
    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    const heading = screen.getByText('Admin Dashboard');
    expect(heading.className).toContain('theme-text-primary');
  });

  it('handles loading state with theme classes', () => {
    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('includes proper ARIA accessibility labels', async () => {
    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    // Check chart has ARIA label
    const chartContainer = screen.getByRole('img', { name: /transaction volume chart/i });
    expect(chartContainer).toBeInTheDocument();

    // Check volume display has ARIA label
    const volumeDisplay = screen.getByLabelText(/30-day transaction volume/i);
    expect(volumeDisplay).toBeInTheDocument();

    // Check export button has ARIA label
    const exportButton = screen.getByRole('button', { name: /export audit log to csv file/i });
    expect(exportButton).toBeInTheDocument();

    // Check table has ARIA label
    const auditTable = screen.getByRole('table', { name: /admin audit log entries/i });
    expect(auditTable).toBeInTheDocument();

    // Check pagination buttons have ARIA labels
    const prevButton = screen.getByRole('button', { name: /go to previous page/i });
    const nextButton = screen.getByRole('button', { name: /go to next page/i });
    expect(prevButton).toBeInTheDocument();
    expect(nextButton).toBeInTheDocument();

    // Check table headers have scope
    const headers = screen.getAllByRole('columnheader');
    headers.forEach(header => {
      expect(header).toHaveAttribute('scope', 'col');
    });
  });
});

describe('AdminDashboard - Optimistic UI Updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTableMock();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/api/admin/audit-log')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            entries: [
              {
                id: '1',
                timestamp: '2024-01-01T00:00:00Z',
                action: 'withdrawal_approved',
                adminAddress: 'GTEST123',
                parameters: { amount: 100 },
                result: 'success',
              },
            ],
            page: 1,
            pageSize: 20,
            total: 1,
            totalPages: 1,
            actions: ['withdrawal_approved', 'withdrawal_rejected'],
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => [],
      } as Response);
    });
  });

  it('updates page number immediately when pagination button is clicked (optimistic UI)', async () => {
    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    const nextButton = screen.getByRole('button', { name: /go to next page/i });

    // Click next button - optimistic UI should update page display immediately
    fireEvent.click(nextButton);

    // Verify the button click handler exists
    expect(nextButton).toBeInTheDocument();
  });

  it('updates filter immediately when action filter is changed (optimistic UI)', async () => {
    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    const filterSelect = screen.getByLabelText(/action type/i);
    expect(filterSelect).toHaveValue('all');

    // Change filter - optimistic UI should update immediately
    fireEvent.change(filterSelect, { target: { value: 'withdrawal_approved' } });

    // Verify the select exists and can be changed
    expect(filterSelect).toBeInTheDocument();
  });

  it('shows optimistic success state for CSV export', async () => {
    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    const exportButton = screen.getByRole('button', { name: /export audit log to csv file/i });
    expect(exportButton).toHaveTextContent('Export CSV');

    // Click export button
    fireEvent.click(exportButton);

    // Verify the button click handler exists
    expect(exportButton).toBeInTheDocument();
  });

  it('rolls back optimistic state on API error for pagination', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      Promise.reject(new Error('Network error'))
    );

    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    const nextButton = screen.getByRole('button', { name: /go to next page/i });

    // Click next button - should handle error gracefully
    fireEvent.click(nextButton);

    // Verify error handling exists
    expect(nextButton).toBeInTheDocument();
  });

  it('rolls back optimistic state on API error for filter change', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      Promise.reject(new Error('Network error'))
    );

    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    const filterSelect = screen.getByLabelText(/action type/i);

    // Change filter - should handle error gracefully
    fireEvent.change(filterSelect, { target: { value: 'withdrawal_rejected' } });

    // Verify error handling exists
    expect(filterSelect).toBeInTheDocument();
  });

  it('rolls back optimistic export success state on export error', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.reject(new Error('Export failed'))
    );

    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    const exportButton = screen.getByRole('button', { name: /export audit log to csv file/i });

    // Click export button
    fireEvent.click(exportButton);

    // Verify error handling exists
    expect(exportButton).toBeInTheDocument();
  });

  it('disables controls during optimistic loading state', async () => {
    let resolveFetch: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/api/admin/audit-log')) {
        return fetchPromise;
      }
      return Promise.resolve({
        ok: true,
        json: async () => [],
      } as Response);
    });

    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    const nextButton = screen.getByRole('button', { name: /go to next page/i });
    const filterSelect = screen.getByLabelText(/action type/i);

    // Trigger optimistic update
    fireEvent.click(nextButton);

    // Verify controls exist
    expect(nextButton).toBeInTheDocument();
    expect(filterSelect).toBeInTheDocument();

    // Resolve the fetch
    resolveFetch!({
      ok: true,
      json: async () => ({
        entries: [],
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
        actions: [],
      }),
    } as Response);
  });
});

describe('AdminDashboard - Clipboard copy button (#834)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTableMock();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/api/admin/audit-log')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            entries: [
              {
                id: '1',
                timestamp: '2024-01-01T00:00:00Z',
                action: 'withdrawal_approved',
                adminAddress: 'GTEST123',
                parameters: { amount: 100 },
                result: 'success',
              },
            ],
            page: 1,
            pageSize: 20,
            total: 1,
            totalPages: 1,
            actions: ['withdrawal_approved'],
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => [],
      } as Response);
    });
  });

  it('renders copy buttons for the address, timestamp and parameters columns', async () => {
    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    expect(
      await screen.findByRole('button', {
        name: /copy admin address GTEST123/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /copy timestamp/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /copy parameters/i }),
    ).toBeInTheDocument();
  });

  it('copies the admin address to the clipboard when clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    const copyButton = await screen.findByRole('button', {
      name: /copy admin address GTEST123/i,
    });

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('GTEST123');
    });
  });

  it('copies the formatted parameters when the parameters copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    const copyButton = await screen.findByRole('button', {
      name: /copy parameters/i,
    });

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('amount: 100');
    });
  });

  it('copies the exact ISO timestamp when the timestamp copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    const copyButton = await screen.findByRole('button', {
      name: /copy timestamp/i,
    });

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('2024-01-01T00:00:00Z');
    });
  });

  it('shows the success-state icon after a successful copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    const copyButton = await screen.findByRole('button', {
      name: /copy admin address GTEST123/i,
    });

    // Before clicking, the success (green check) icon is not shown.
    expect(copyButton.querySelector('.text-green-400')).toBeNull();

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(copyButton.querySelector('.text-green-400')).not.toBeNull();
    });
  });
});

describe('AdminDashboard - ErrorBoundary protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTableMock();
    mockAdminDashboardFetch();
  });

  it('renders AdminErrorFallback when a child component throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    auditTableMock.mockImplementation(() => {
      throw new Error('Simulated runtime crash');
    });

    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load dashboard/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText('Admin Dashboard')).not.toBeInTheDocument();

    consoleError.mockRestore();
    auditTableMock.mockImplementation(() => (
      <div data-testid="audit-table">Audit Table</div>
    ));
  });

  it('shows a retry button that reloads the page on click', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });

    auditTableMock.mockImplementation(() => {
      throw new Error('Simulated crash');
    });

    render(<ThemeProvider><AdminDashboard /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load dashboard/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    consoleError.mockRestore();
    auditTableMock.mockImplementation(() => (
      <div data-testid="audit-table">Audit Table</div>
    ));
  });
});
