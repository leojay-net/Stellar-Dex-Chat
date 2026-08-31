'use client';

import { useState } from 'react';
import ChatSearchPanel from '@/components/ChatSearchPanel';
import { ChatSession } from '@/types';

/** Deterministic fixture sessions for search tests. */
const SESSIONS: ChatSession[] = [
  {
    id: 'session-alpha',
    title: 'Alpha XLM swap',
    messages: [
      {
        id: 'msg-a1',
        role: 'user',
        content: 'How do I swap XLM to USDC?',
        timestamp: new Date('2026-06-01T10:00:00Z'),
        metadata: { status: 'sent' },
      },
      {
        id: 'msg-a2',
        role: 'assistant',
        content: 'You can swap using the DEX interface.',
        timestamp: new Date('2026-06-01T10:01:00Z'),
        metadata: { status: 'sent' },
      },
    ],
    createdAt: new Date('2026-06-01T10:00:00Z'),
    lastUpdated: new Date('2026-06-01T10:01:00Z'),
    walletAddress: 'GBEFLW6RTALNHCL7HW2INWB4ASHZ7E6MF6E2IOIIMBVEAU2B2B4XLRQW',
  },
  {
    id: 'session-beta',
    title: 'Bridge deposit status',
    messages: [
      {
        id: 'msg-b1',
        role: 'user',
        content: 'Check my bridge deposit status',
        timestamp: new Date('2026-07-15T14:00:00Z'),
        metadata: { status: 'sent' },
      },
    ],
    createdAt: new Date('2026-07-15T14:00:00Z'),
    lastUpdated: new Date('2026-07-15T14:00:00Z'),
  },
];

/**
 * Test harness page for ChatSearchPanel E2E tests.
 *
 * Renders the search panel in a fixed-height container with fixture sessions
 * and logs selected results so tests can assert navigation behaviour.
 */
export default function TestChatSearchPanelPage() {
  const [isOpen, setIsOpen] = useState(true);
  const [lastResult, setLastResult] = useState<{
    sessionId: string;
    messageId: string;
  } | null>(null);

  return (
    <main className="min-h-screen p-4 flex flex-col gap-4">
      <h1 className="text-lg font-semibold">ChatSearchPanel Test Harness</h1>

      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Open search panel"
        className="w-fit px-3 py-1 text-sm rounded border"
      >
        Open Search
      </button>

      {lastResult && (
        <p data-testid="selected-result" className="text-sm">
          Selected: {lastResult.sessionId} / {lastResult.messageId}
        </p>
      )}

      {isOpen && (
        <div className="border rounded-xl overflow-hidden" style={{ height: '500px' }}>
          <ChatSearchPanel
            sessions={SESSIONS}
            onSelectResult={(sessionId, messageId) =>
              setLastResult({ sessionId, messageId })
            }
            onClose={() => setIsOpen(false)}
          />
        </div>
      )}
    </main>
  );
}
