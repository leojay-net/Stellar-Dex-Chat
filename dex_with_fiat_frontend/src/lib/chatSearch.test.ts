import { describe, expect, it } from 'vitest';
import {
  findHighlights,
  splitByHighlights,
  searchChatHistory,
} from './chatSearch';
import { ChatMessage, ChatSession } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(
  overrides: Partial<ChatMessage> & { content: string },
): ChatMessage {
  return {
    id: Math.random().toString(36).slice(2),
    role: 'assistant',
    timestamp: new Date('2024-06-15T12:00:00Z'),
    ...overrides,
  };
}

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Test Chat',
    messages: [],
    createdAt: new Date('2024-06-15'),
    lastUpdated: new Date('2024-06-15'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// findHighlights
// ---------------------------------------------------------------------------

describe('findHighlights', () => {
  it('returns empty array when keyword is empty', () => {
    expect(findHighlights('hello world', '')).toEqual([]);
  });

  it('returns empty array when keyword is whitespace', () => {
    expect(findHighlights('hello world', '   ')).toEqual([]);
  });

  it('finds a single match', () => {
    expect(findHighlights('hello world', 'world')).toEqual([[6, 11]]);
  });

  it('finds multiple non-overlapping matches', () => {
    expect(findHighlights('abc abc abc', 'abc')).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
    ]);
  });

  it('is case-insensitive', () => {
    expect(findHighlights('Hello WORLD hello', 'hello')).toEqual([
      [0, 5],
      [12, 17],
    ]);
  });

  it('returns empty when no match', () => {
    expect(findHighlights('stellar lumens', 'bitcoin')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// splitByHighlights
// ---------------------------------------------------------------------------

describe('splitByHighlights', () => {
  it('returns single non-highlighted segment when no highlights', () => {
    expect(splitByHighlights('hello', [])).toEqual([
      { text: 'hello', highlight: false },
    ]);
  });

  it('splits text around a single highlight', () => {
    const result = splitByHighlights('hello world', [[6, 11]]);
    expect(result).toEqual([
      { text: 'hello ', highlight: false },
      { text: 'world', highlight: true },
    ]);
  });

  it('handles highlight at start of text', () => {
    const result = splitByHighlights('hello world', [[0, 5]]);
    expect(result).toEqual([
      { text: 'hello', highlight: true },
      { text: ' world', highlight: false },
    ]);
  });

  it('handles highlight at end of text', () => {
    const result = splitByHighlights('hello world', [[6, 11]]);
    expect(result).toContainEqual({ text: 'world', highlight: true });
  });

  it('handles multiple highlights', () => {
    const text = 'abc def abc';
    const highlights: Array<[number, number]> = [[0, 3], [8, 11]];
    const result = splitByHighlights(text, highlights);
    expect(result).toEqual([
      { text: 'abc', highlight: true },
      { text: ' def ', highlight: false },
      { text: 'abc', highlight: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// searchChatHistory – keyword filtering
// ---------------------------------------------------------------------------

describe('searchChatHistory – keyword', () => {
  it('returns no matches when all filters are empty', () => {
    const session = makeSession({
      messages: [makeMessage({ content: 'hello world' })],
    });
    const result = searchChatHistory([session], {
      keyword: '',
      walletAddress: '',
      dateFrom: '',
      dateTo: '',
    });
    expect(result.matches).toHaveLength(0);
  });

  it('finds messages containing the keyword', () => {
    const msg = makeMessage({ content: 'Your XLM balance is 100' });
    const session = makeSession({ messages: [msg] });
    const result = searchChatHistory([session], {
      keyword: 'xlm',
      walletAddress: '',
      dateFrom: '',
      dateTo: '',
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].message.id).toBe(msg.id);
  });

  it('includes highlight positions in results', () => {
    const msg = makeMessage({ content: 'Send XLM to your wallet' });
    const session = makeSession({ messages: [msg] });
    const result = searchChatHistory([session], {
      keyword: 'XLM',
      walletAddress: '',
      dateFrom: '',
      dateTo: '',
    });
    expect(result.matches[0].highlights.length).toBeGreaterThan(0);
  });

  it('excludes messages that do not match keyword', () => {
    const match = makeMessage({ content: 'transfer XLM now' });
    const noMatch = makeMessage({ content: 'what is the weather' });
    const session = makeSession({ messages: [match, noMatch] });
    const result = searchChatHistory([session], {
      keyword: 'XLM',
      walletAddress: '',
      dateFrom: '',
      dateTo: '',
    });
    expect(result.matches).toHaveLength(1);
  });

  it('skips system messages', () => {
    const sys = makeMessage({ content: 'XLM system message', role: 'system' });
    const session = makeSession({ messages: [sys] });
    const result = searchChatHistory([session], {
      keyword: 'XLM',
      walletAddress: '',
      dateFrom: '',
      dateTo: '',
    });
    expect(result.matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// searchChatHistory – wallet address filtering
// ---------------------------------------------------------------------------

describe('searchChatHistory – walletAddress', () => {
  it('filters sessions by wallet address substring', () => {
    const sessionA = makeSession({
      walletAddress: 'GABCDEF1234',
      messages: [makeMessage({ content: 'hello' })],
    });
    const sessionB = makeSession({
      walletAddress: 'GXYZ9876',
      messages: [makeMessage({ content: 'hello' })],
    });
    const result = searchChatHistory([sessionA, sessionB], {
      keyword: 'hello',
      walletAddress: 'ABCDEF',
      dateFrom: '',
      dateTo: '',
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].sessionId).toBe(sessionA.id);
  });

  it('is case-insensitive for wallet address', () => {
    const session = makeSession({
      walletAddress: 'GABCDEF',
      messages: [makeMessage({ content: 'deposit' })],
    });
    const result = searchChatHistory([session], {
      keyword: 'deposit',
      walletAddress: 'gabcdef',
      dateFrom: '',
      dateTo: '',
    });
    expect(result.matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// searchChatHistory – date range filtering
// ---------------------------------------------------------------------------

describe('searchChatHistory – date range', () => {
  it('includes messages within the date range', () => {
    const msg = makeMessage({
      content: 'deposit confirmed',
      timestamp: new Date('2024-06-15T12:00:00Z'),
    });
    const session = makeSession({ messages: [msg] });
    const result = searchChatHistory([session], {
      keyword: 'deposit',
      walletAddress: '',
      dateFrom: '2024-06-01',
      dateTo: '2024-06-30',
    });
    expect(result.matches).toHaveLength(1);
  });

  it('excludes messages before dateFrom', () => {
    const msg = makeMessage({
      content: 'deposit confirmed',
      timestamp: new Date('2024-05-01T12:00:00Z'),
    });
    const session = makeSession({ messages: [msg] });
    const result = searchChatHistory([session], {
      keyword: 'deposit',
      walletAddress: '',
      dateFrom: '2024-06-01',
      dateTo: '',
    });
    expect(result.matches).toHaveLength(0);
  });

  it('excludes messages after dateTo', () => {
    const msg = makeMessage({
      content: 'deposit confirmed',
      timestamp: new Date('2024-08-01T12:00:00Z'),
    });
    const session = makeSession({ messages: [msg] });
    const result = searchChatHistory([session], {
      keyword: 'deposit',
      walletAddress: '',
      dateFrom: '',
      dateTo: '2024-06-30',
    });
    expect(result.matches).toHaveLength(0);
  });

  it('can search by date range alone (no keyword)', () => {
    const msg = makeMessage({
      content: 'anything',
      timestamp: new Date('2024-06-15T10:00:00Z'),
    });
    const session = makeSession({ messages: [msg] });
    const result = searchChatHistory([session], {
      keyword: '',
      walletAddress: '',
      dateFrom: '2024-06-01',
      dateTo: '2024-06-30',
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].highlights).toHaveLength(0);
  });
});
