'use client';

import React from 'react';
import ChatMessages from '@/components/ChatMessages';
import { ChatMessage } from '@/types';

const sampleMessages: ChatMessage[] = [
  {
    id: 'm1',
    role: 'assistant',
    content: 'Hello! This message contains a [link](https://example.com) and some **bold** text.',
    timestamp: new Date(),
    metadata: {
      status: 'sent',
    },
  },
  {
    id: 'm2',
    role: 'assistant',
    content: 'Here is a transaction preview',
    timestamp: new Date(),
    metadata: {
      status: 'sent',
      transactionData: {
        type: 'fiat_conversion',
        tokenIn: 'XLM',
        amountIn: '123.45',
        fiatAmount: '10.00',
        fiatCurrency: 'USD',
        transactionId: 'tx-abcdef1234567890',
        txHash: '0xdeadbeefcafebabe',
        receiptId: 'r-1234567890abcdef',
        note: 'Test deposit',
      },
      confirmationRequired: true,
    },
  },
  {
    id: 'm3',
    role: 'assistant',
    content: 'This message has suggested actions',
    timestamp: new Date(),
    metadata: {
      status: 'sent',
      suggestedActions: [
        { id: 'a1', label: 'Confirm', type: 'confirm_fiat', priority: true },
        { id: 'a2', label: 'Cancel', type: 'cancel', priority: false },
      ],
    },
  },
  {
    id: 'm4',
    role: 'user',
    content: 'This is a user message',
    timestamp: new Date(),
    metadata: { status: 'sent' },
  },
  {
    id: 'm5',
    role: 'assistant',
    content: 'This message simulates a failure',
    timestamp: new Date(),
    error: { message: 'Failed to send', timestamp: new Date(), retryAttempts: 2 },
    metadata: { status: 'failed' },
  },
];

export default function Page() {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <h1 style={{ padding: 16 }}>Test Message Fixtures</h1>
      <div style={{ flex: 1 }}>
        <ChatMessages
          messages={sampleMessages}
          onActionClick={() => undefined}
        />
      </div>
    </div>
  );
}
