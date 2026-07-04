'use client';

import { useEffect } from 'react';
import SplitViewComparison from '@/components/SplitViewComparison';
import { useSplitView } from '@/hooks/useSplitView';
import type { ChatSession } from '@/types';

const leftSession: ChatSession = {
  id: 'session-left',
  title: 'Left Thread',
  messages: [
    {
      id: 'left-1',
      role: 'user',
      content: 'Left pane message content',
      timestamp: new Date('2024-01-01T10:00:00Z'),
      metadata: { status: 'sent' },
    },
  ],
  createdAt: new Date('2024-01-01T09:00:00Z'),
  lastUpdated: new Date('2024-01-01T10:00:00Z'),
};

const rightSession: ChatSession = {
  id: 'session-right',
  title: 'Right Thread',
  messages: [
    {
      id: 'right-1',
      role: 'assistant',
      content: 'Right pane message content',
      timestamp: new Date('2024-01-02T10:00:00Z'),
      metadata: { status: 'sent' },
    },
  ],
  createdAt: new Date('2024-01-02T09:00:00Z'),
  lastUpdated: new Date('2024-01-02T10:00:00Z'),
};

function SplitViewFixture() {
  const sessions = [leftSession, rightSession];
  const splitView = useSplitView(sessions);

  useEffect(() => {
    splitView.open(leftSession.id, rightSession.id);
  }, [splitView]);

  return <SplitViewComparison splitView={splitView} sessions={sessions} />;
}

export default function TestSplitViewComparisonPage() {
  return (
    <main className="h-screen">
      <SplitViewFixture />
    </main>
  );
}
