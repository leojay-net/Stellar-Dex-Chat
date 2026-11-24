'use client';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import type { ChatSession } from '@/types';

const ChatSearchPanel = dynamic(() => import('./ChatSearchPanel'), {
  ssr: false,
});

interface ChatSearchPanelWrapperProps {
  sessions: ChatSession[];
  onSelectResult: (sessionId: string) => void;
  onClose: () => void;
}

export default function ChatSearchPanelWrapper(
  props: ChatSearchPanelWrapperProps,
) {
  return (
    <Suspense fallback={null}>
      <ChatSearchPanel {...props} />
    </Suspense>
  );
}
