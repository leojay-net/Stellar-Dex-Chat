'use client';

import { useState } from 'react';
import ChatInput from '@/components/ChatInput';

/**
 * Test harness page for ChatInput E2E tests.
 *
 * Exposes a controlled form around ChatInput so tests can verify sending,
 * error states, keyboard shortcuts, command palette, and emoji picker.
 */
export default function TestChatInputPage() {
  const [messages, setMessages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  const handleSendMessage = (msg: string) => {
    setIsLoading(true);
    setMessages((prev) => [...prev, msg]);
    // Simulate async AI response completing after 300 ms
    setTimeout(() => setIsLoading(false), 300);
  };

  const handleCancelRequest = () => {
    setIsLoading(false);
    setCancelled(true);
  };

  return (
    <main className="min-h-screen flex flex-col p-4">
      <h1 className="text-lg font-semibold mb-4">ChatInput Test Harness</h1>

      {/* Sent-messages log for test assertions */}
      <ul data-testid="sent-messages" className="flex-1 mb-4 space-y-1">
        {messages.map((m, i) => (
          <li key={i} data-testid="sent-message" className="text-sm border rounded p-2">
            {m}
          </li>
        ))}
      </ul>

      {cancelled && (
        <p data-testid="cancel-notice" className="text-xs text-amber-600 mb-2">
          Request cancelled.
        </p>
      )}

      <ChatInput
        onSendMessage={handleSendMessage}
        onCancelRequest={handleCancelRequest}
        isLoading={isLoading}
        placeholder="Type a message…"
        sessionId="harness-session"
      />
    </main>
  );
}
