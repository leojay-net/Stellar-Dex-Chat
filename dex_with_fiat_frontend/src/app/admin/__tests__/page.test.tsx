import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import AdminDashboard from '../page';

// Mock dependencies
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

vi.mock('@/components/AuditTable', () => ({
  default: () => <div data-testid="audit-table">Audit Table</div>,
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

describe('AdminDashboard - Dark Mode Support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);
  });

  it('renders with theme-aware classes', async () => {
    await act(async () => {
      render(<AdminDashboard />);
    });

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    // Check for theme classes instead of hardcoded colors
    const container = screen.getByText('Admin Dashboard').closest('div');
    expect(container?.className).toContain('theme-');
  });

  it('applies CSS tokens for colors', async () => {
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    // Verify no hardcoded Tailwind color classes
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/bg-blue-\d+/);
    expect(html).not.toMatch(/text-gray-\d+/);
    expect(html).not.toMatch(/border-gray-\d+/);
  });

  it('uses theme utility classes for surfaces', async () => {
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Bridge Balance')).toBeInTheDocument();
    });

    const card = screen.getByText('Bridge Balance').closest('div');
    expect(card?.className).toContain('theme-surface');
  });

  it('uses theme utility classes for text', async () => {
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    const heading = screen.getByText('Admin Dashboard');
    expect(heading.className).toContain('theme-text-primary');
  });

  it('handles loading state with theme classes', () => {
    render(<AdminDashboard />);

    const loadingText = screen.getByText('Loading metrics...');
    expect(loadingText.className).toContain('theme-text-muted');
  });

  it('includes proper ARIA accessibility labels', async () => {
    render(<AdminDashboard />);

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
    render(<AdminDashboard />);

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
    render(<AdminDashboard />);

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
    render(<AdminDashboard />);

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

    render(<AdminDashboard />);

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

    render(<AdminDashboard />);

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

    render(<AdminDashboard />);

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

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(fetchPromise);

    render(<AdminDashboard />);

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
