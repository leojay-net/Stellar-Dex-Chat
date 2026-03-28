import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MessageSquare, Search, Coins, WifiOff } from 'lucide-react';
import EmptyState from '../EmptyState';

describe('EmptyState', () => {
  it('renders the chat-list empty variant (no history)', () => {
    const { asFragment } = render(
      <EmptyState
        icon={MessageSquare}
        title="No conversations yet"
        description="Start chatting to see your history here"
        cta={{ label: 'New Conversation', onClick: vi.fn() }}
      />,
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it('renders the chat-list search-empty variant', () => {
    const { asFragment } = render(
      <EmptyState
        icon={Search}
        title="No conversations found"
        description='No results for "stellar"'
        cta={{ label: 'Clear search', onClick: vi.fn() }}
      />,
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it('renders the transaction-history empty variant', () => {
    const { asFragment } = render(
      <EmptyState
        icon={Coins}
        title="No transactions yet"
        description="Deposits, payouts, risk checks, and notes will appear here."
        className="py-3"
      />,
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it('renders the bridge-unavailable variant with retry CTA', () => {
    const { asFragment } = render(
      <EmptyState
        icon={WifiOff}
        title="Bridge data unavailable"
        description="Could not fetch the current bridge limit. Please retry."
        cta={{ label: 'Retry', onClick: vi.fn() }}
        className="py-2"
      />,
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it('renders without optional props (icon + title only)', () => {
    const { asFragment } = render(
      <EmptyState icon={MessageSquare} title="Nothing here" />,
    );
    expect(asFragment()).toMatchSnapshot();
  });
});
