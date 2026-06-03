import React from 'react';
import { renderToString } from 'react-dom/server';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import ChatInput from '../ChatInput';

// Regression tests for issue #607 — the shortcut label must not be derived
// from `navigator` during render, otherwise the server markup (no Apple
// platform) and the first client render on an Apple device disagree and React
// reports a hydration mismatch. The platform is now detected in an effect, so
// the initial render is always the SSR-safe "Ctrl+Enter".

const mockWalletContext = {
  connection: {
    address: '',
    publicKey: '',
    isConnected: true,
    network: '',
    networkPassphrase: '',
  },
  accounts: [],
  selectedAccountIndex: 0,
  selectAccount: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  signTx: vi.fn(),
  isFreighterInstalled: false,
  isLoading: false,
  error: null,
  sessionExpired: false,
  clearSessionExpired: vi.fn(),
  mockConnect: vi.fn(),
  isNetworkMismatch: false,
};

vi.mock('@/contexts/StellarWalletContext', () => ({
  useStellarWallet: () => mockWalletContext,
}));

vi.mock('@/contexts/TranslationContext', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/draftUtils', () => ({
  saveDraft: vi.fn(),
  getDraft: vi.fn(() => ''),
  clearDraft: vi.fn(),
}));

const defaultProps = {
  onSendMessage: vi.fn(),
  isLoading: false,
  placeholder: 'Type a message...',
};

function setPlatform(platform: string) {
  Object.defineProperty(window.navigator, 'platform', {
    value: platform,
    configurable: true,
  });
}

describe('ChatInput - hydration safety of platform shortcut label (#607)', () => {
  const originalPlatform = window.navigator.platform;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('server-renders the SSR-safe Ctrl+Enter label even on an Apple platform', () => {
    // Simulate an Apple client. Before the fix, reading navigator during render
    // made the initial render produce "Cmd+Enter", mismatching the server HTML.
    setPlatform('MacIntel');

    const markup = renderToString(<ChatInput {...defaultProps} />);

    expect(markup).toContain('Ctrl+Enter');
    expect(markup).not.toContain('Cmd+Enter');
  });

  it('upgrades to the Apple label after mount on an Apple platform', async () => {
    setPlatform('MacIntel');

    render(<ChatInput {...defaultProps} />);

    // After the post-mount effect runs, the client shows the Apple shortcut.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /send message \(Cmd\+Enter\)/i }),
      ).toBeInTheDocument();
    });
  });

  it('keeps the Ctrl+Enter label on a non-Apple platform', async () => {
    setPlatform('Win32');

    render(<ChatInput {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /send message \(Ctrl\+Enter\)/i }),
      ).toBeInTheDocument();
    });
  });
});
