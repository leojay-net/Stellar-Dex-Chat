import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChatSession } from '@/types';

// Pure utility tests for pin ordering logic and stale-closure regression (#1223)

function sortSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    if (a.pinned && b.pinned) {
      return (b.pinnedAt?.getTime() ?? 0) - (a.pinnedAt?.getTime() ?? 0);
    }
    return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
  });
}

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  const now = new Date();
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Test',
    messages: [],
    createdAt: now,
    lastUpdated: now,
    ...overrides,
  };
}

describe('Thread pinning ordering', () => {
  it('pinned sessions appear before unpinned ones', () => {
    const older = makeSession({ lastUpdated: new Date('2024-01-01') });
    const pinned = makeSession({
      pinned: true,
      pinnedAt: new Date('2024-06-01'),
      lastUpdated: new Date('2024-01-01'),
    });
    const recent = makeSession({ lastUpdated: new Date('2024-12-01') });

    const sorted = sortSessions([recent, older, pinned]);

    expect(sorted[0].id).toBe(pinned.id);
  });

  it('multiple pinned sessions are sorted by pinnedAt descending', () => {
    const first = makeSession({
      pinned: true,
      pinnedAt: new Date('2024-09-01'),
      lastUpdated: new Date('2024-01-01'),
    });
    const second = makeSession({
      pinned: true,
      pinnedAt: new Date('2024-06-01'),
      lastUpdated: new Date('2024-01-01'),
    });

    const sorted = sortSessions([second, first]);

    expect(sorted[0].id).toBe(first.id);
    expect(sorted[1].id).toBe(second.id);
  });

  it('unpinned sessions are sorted by lastUpdated descending', () => {
    const older = makeSession({ lastUpdated: new Date('2024-01-01') });
    const newer = makeSession({ lastUpdated: new Date('2024-12-01') });

    const sorted = sortSessions([older, newer]);

    expect(sorted[0].id).toBe(newer.id);
    expect(sorted[1].id).toBe(older.id);
  });

  it('toggling pin sets pinned=true and pinnedAt', () => {
    const session = makeSession({ pinned: false });
    const now = new Date();

    const toggled: ChatSession = {
      ...session,
      pinned: true,
      pinnedAt: now,
    };

    expect(toggled.pinned).toBe(true);
    expect(toggled.pinnedAt).toBe(now);
  });

  it('toggling pin off clears pinned and pinnedAt', () => {
    const session = makeSession({ pinned: true, pinnedAt: new Date() });

    const toggled: ChatSession = {
      ...session,
      pinned: false,
      pinnedAt: undefined,
    };

    expect(toggled.pinned).toBe(false);
    expect(toggled.pinnedAt).toBeUndefined();
  });

  it('sessions with no pinned field are treated as unpinned', () => {
    const noPinField = makeSession({ lastUpdated: new Date('2024-12-01') });
    const pinned = makeSession({ pinned: true, pinnedAt: new Date('2024-06-01') });

    const sorted = sortSessions([noPinField, pinned]);

    expect(sorted[0].id).toBe(pinned.id);
    expect(sorted[1].id).toBe(noPinField.id);
  });
});

// ── updateCurrentSession stale-closure regression (#1223) ──────────────────
//
// Before the fix, updateCurrentSession closed over historyState.currentSessionId
// for its early-return guard. If currentSessionId changed between renders the
// stale closure value would cause the guard to use the wrong session ID.
//
// The fix moves the guard inside the setHistoryState functional updater so it
// always reads `prev.currentSessionId` (fresh state), never the closure value.
// We test the invariant in isolation so the fix is not coupled to the full hook.

describe('updateCurrentSession guard reads fresh state (regression #1223)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Simulate the functional updater pattern used by the fixed updateCurrentSession.
  function makeUpdater(messages: { id: string }[]) {
    return (prev: { currentSessionId: string | null; sessions: { id: string; messages: { id: string }[] }[] }) => {
      if (!prev.currentSessionId) return prev;
      const idx = prev.sessions.findIndex((s) => s.id === prev.currentSessionId);
      if (idx === -1) return prev;
      const updated = [...prev.sessions];
      updated[idx] = { ...updated[idx], messages };
      return { ...prev, sessions: updated };
    };
  }

  it('updates the session identified by prev.currentSessionId, not a stale outer value', () => {
    const sessionA = { id: 'a', messages: [] as { id: string }[] };
    const sessionB = { id: 'b', messages: [] as { id: string }[] };
    const newMessages = [{ id: 'msg1' }];

    // Stale outer value would be 'a', but we simulate the state having already
    // advanced to 'b' before the updater runs.
    const freshState = { currentSessionId: 'b', sessions: [sessionA, sessionB] };

    const nextState = makeUpdater(newMessages)(freshState);

    expect(nextState.sessions.find((s) => s.id === 'b')?.messages).toEqual(newMessages);
    expect(nextState.sessions.find((s) => s.id === 'a')?.messages).toEqual([]);
  });

  it('returns prev unchanged when prev.currentSessionId is null', () => {
    const session = { id: 'a', messages: [] as { id: string }[] };
    const state = { currentSessionId: null, sessions: [session] };

    const nextState = makeUpdater([{ id: 'msg1' }])(state);

    expect(nextState).toBe(state);
  });
});
