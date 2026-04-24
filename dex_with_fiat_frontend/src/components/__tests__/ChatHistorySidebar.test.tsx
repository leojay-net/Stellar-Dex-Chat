import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ChatHistorySidebar from '@/components/ChatHistorySidebar';

vi.mock('@/hooks/useChatHistory', () => ({
  useChatHistory: () => ({
    pinnedSessions: [],
    unpinnedSessions: [],
    currentSessionId: null,
    deleteSession: vi.fn(),
    clearAllHistory: vi.fn(),
    exportSessionAsJSON: vi.fn(),
    exportSessionAsTXT: vi.fn(),
    searchSessions: vi.fn(() => []),
    togglePin: vi.fn(),
    hasHistory: false,
  }),
}));

vi.mock('@/hooks/useTxHistory', () => ({
  useTxHistory: () => ({
    entries: [],
    clearEntries: vi.fn(),
    updateEntry: vi.fn(),
  }),
}));

vi.mock('@/contexts/StellarWalletContext', () => ({
  useStellarWallet: () => ({
    connection: { address: null as string | null },
  }),
}));

describe('ChatHistorySidebar', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    } as Response);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /**
   * Regression (#651): root chrome must use theme border color so the sidebar
   * separator matches the rest of the layout (not Tailwind’s default border color).
   */
  it('applies theme border color to the root sidebar chrome', () => {
    const { container } = render(
      <ChatHistorySidebar onLoadSession={vi.fn()} isCollapsed={false} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/\btheme-border\b/);
    expect(root.className).toMatch(/\bborder-r\b/);
  });
});
