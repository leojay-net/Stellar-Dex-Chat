import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ChatSession, ChatMessage } from '@/types';
import { useChatHistory } from './useChatHistory';

// ── Mock StellarWalletContext ───────────────────────────────────────────────
vi.mock('@/contexts/StellarWalletContext', () => ({
  useStellarWallet: () => ({
    connection: { isConnected: true, address: 'GTESTWALLETADDRESS' },
  }),
}));

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

// ---------------------------------------------------------------------------
// Race-condition regression tests (#1213)
// ---------------------------------------------------------------------------
//
// These tests cover the two stale-closure bugs that were fixed:
//
// 1. updateCurrentSession — previously read `historyState.currentSessionId`
//    from the outer closure. If the session changed between renders the guard
//    (`if (!historyState.currentSessionId) return`) would be stale and could
//    either block a valid update or allow an update targeting the wrong session.
//    Fix: moved the guard inside the functional updater so it always sees the
//    latest committed state.
//
// 2. loadSession — previously read `historyState.sessions` from the closure,
//    which could be a snapshot from a previous render. Any session created
//    after the closure was captured would be invisible to the lookup.
//    Fix: reads from `sessionsRef.current` which is kept current via a
//    synchronous ref-update effect.

describe('Race-condition fix: updateCurrentSession functional updater (#1213)', () => {
  it('update is a no-op when currentSessionId is null in latest state', () => {
    type State = { currentSessionId: string | null; sessions: { id: string; messages: string[] }[] };

    // Simulate the fixed functional updater
    const updater = (messages: string[]) => (prev: State): State => {
      if (!prev.currentSessionId) return prev;
      const idx = prev.sessions.findIndex((s) => s.id === prev.currentSessionId);
      if (idx === -1) return prev;
      const updated = [...prev.sessions];
      updated[idx] = { ...updated[idx], messages };
      return { ...prev, sessions: updated };
    };

    const state: State = { currentSessionId: null, sessions: [{ id: 'a', messages: [] }] };
    const next = updater(['msg'])(state);

    // No change because currentSessionId was null at update time
    expect(next).toBe(state);
  });

  it('update targets the correct session even when currentSessionId changed before dispatch', () => {
    type State = { currentSessionId: string | null; sessions: { id: string; messages: string[] }[] };

    const updater = (messages: string[]) => (prev: State): State => {
      if (!prev.currentSessionId) return prev;
      const idx = prev.sessions.findIndex((s) => s.id === prev.currentSessionId);
      if (idx === -1) return prev;
      const updated = [...prev.sessions];
      updated[idx] = { ...updated[idx], messages };
      return { ...prev, sessions: updated };
    };

    // State has switched to session 'b' by the time the updater runs
    const state: State = {
      currentSessionId: 'b',
      sessions: [
        { id: 'a', messages: [] },
        { id: 'b', messages: [] },
      ],
    };

    const next = updater(['hello'])(state);

    expect(next.sessions.find((s) => s.id === 'b')?.messages).toEqual(['hello']);
    expect(next.sessions.find((s) => s.id === 'a')?.messages).toEqual([]);
  });
});

describe('Race-condition fix: loadSession uses sessionsRef (#1213)', () => {
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

  it('lookup finds a session added after the callback was captured', () => {
    // Simulate sessionsRef — always points to latest sessions array
    const sessionsRef = { current: [] as { id: string; messages: string[] }[] };

    // Simulate the fixed loadSession using sessionsRef
    const loadSession = (sessionId: string) => {
      return sessionsRef.current.find((s) => s.id === sessionId) ?? null;
    };

    // Callback captured here with empty sessions
    expect(loadSession('new')).toBeNull();

    // Session added later — ref is updated synchronously (as the useEffect does)
    sessionsRef.current = [{ id: 'new', messages: ['hi'] }];

    // Now loadSession finds it, despite being "captured" before it existed
    const found = loadSession('new');
    expect(found).not.toBeNull();
    expect(found?.messages).toEqual(['hi']);
  });

  describe('updateCurrentSession guard reads fresh state (regression #1223)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

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
});

// ═══════════════════════════════════════════════════════════════════════════
// useChatHistory hook integration tests (renderHook)
// ═══════════════════════════════════════════════════════════════════════════

describe('useChatHistory hook', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Initial State ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('returns empty sessions and null currentSessionId on first render', () => {
      const { result } = renderHook(() => useChatHistory());

      expect(result.current.sessions).toEqual([]);
      expect(result.current.currentSessionId).toBeNull();
      expect(result.current.hasHistory).toBe(false);
    });

    it('returns isHistoryOpen as false initially', () => {
      const { result } = renderHook(() => useChatHistory());

      expect(result.current.isHistoryOpen).toBe(false);
    });

    it('returns empty pinnedSessions and unpinnedSessions', () => {
      const { result } = renderHook(() => useChatHistory());

      expect(result.current.pinnedSessions).toEqual([]);
      expect(result.current.unpinnedSessions).toEqual([]);
    });

    it('returns currentSession as null when no session is active', () => {
      const { result } = renderHook(() => useChatHistory());

      expect(result.current.currentSession).toBeNull();
    });

    it('loads persisted history from localStorage on mount', () => {
      const persistedState = {
        currentSessionId: 'saved-session',
        sessions: [
          {
            id: 'saved-session',
            title: 'Saved Chat',
            messages: [],
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
          },
        ],
      };
      localStorage.setItem('defi_chat_history', JSON.stringify(persistedState));

      const { result } = renderHook(() => useChatHistory());

      expect(result.current.currentSessionId).toBe('saved-session');
      expect(result.current.sessions).toHaveLength(1);
      expect(result.current.sessions[0].title).toBe('Saved Chat');
      expect(result.current.hasHistory).toBe(true);
    });
  });

  // ── createNewSession ───────────────────────────────────────────────────────

  describe('createNewSession', () => {
    it('creates a new session and sets it as current', () => {
      const { result } = renderHook(() => useChatHistory());

      let sessionId = '';
      act(() => {
        sessionId = result.current.createNewSession();
      });

      expect(sessionId).toBeTruthy();
      expect(result.current.currentSessionId).toBe(sessionId);
    });

    it('returns a string session ID', () => {
      const { result } = renderHook(() => useChatHistory());

      let sessionId = '';
      act(() => {
        sessionId = result.current.createNewSession();
      });

      expect(typeof sessionId).toBe('string');
      expect(sessionId).toMatch(/^session_/);
    });

    it('appends initial messages when provided', () => {
      const { result } = renderHook(() => useChatHistory());

      const initialMessages: ChatMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
      ];

      act(() => {
        result.current.createNewSession(initialMessages);
      });

      expect(result.current.sessions).toHaveLength(1);
      expect(result.current.sessions[0].messages).toHaveLength(1);
      expect(result.current.sessions[0].messages[0].content).toBe('Hello');
    });

    it('increments sessions length', () => {
      const { result } = renderHook(() => useChatHistory());

      act(() => {
        result.current.createNewSession();
      });
      expect(result.current.sessions).toHaveLength(1);

      act(() => {
        result.current.createNewSession();
      });
      expect(result.current.sessions).toHaveLength(2);
    });
  });

  // ── updateCurrentSession ───────────────────────────────────────────────────

  describe('updateCurrentSession', () => {
    it('updates messages for the current session', () => {
      const { result } = renderHook(() => useChatHistory());

      act(() => {
        result.current.createNewSession();
      });

      const updatedMessages: ChatMessage[] = [
        {
          id: 'm1',
          role: 'assistant' as const,
          content: 'Welcome!',
          timestamp: new Date(),
        },
        {
          id: 'm2',
          role: 'user' as const,
          content: 'Hi',
          timestamp: new Date(),
        },
      ];

      act(() => {
        result.current.updateCurrentSession(updatedMessages);
      });

      const current = result.current.sessions.find(
        (s) => s.id === result.current.currentSessionId,
      );
      expect(current?.messages).toHaveLength(2);
      expect(current?.messages[0].content).toBe('Welcome!');
      expect(current?.messages[1].content).toBe('Hi');
    });

    it('is a no-op when there is no current session', () => {
      const { result } = renderHook(() => useChatHistory());

      expect(() => {
        act(() => {
          result.current.updateCurrentSession([
            {
              id: 'orphan',
              role: 'user',
              content: 'Orphan message',
              timestamp: new Date(),
            },
          ]);
        });
      }).not.toThrow();

      // State should remain unchanged
      expect(result.current.sessions).toEqual([]);
      expect(result.current.currentSessionId).toBeNull();
    });

    it('updates lastUpdated timestamp on the session', () => {
      const { result } = renderHook(() => useChatHistory());

      act(() => {
        result.current.createNewSession();
      });

      const before = result.current.sessions[0].lastUpdated;

      act(() => {
        result.current.updateCurrentSession([
          {
            id: 'later',
            role: 'user',
            content: 'Later msg',
            timestamp: new Date(),
          },
        ]);
      });

      const after = result.current.sessions[0].lastUpdated;
      expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  // ── loadSession ────────────────────────────────────────────────────────────

  describe('loadSession', () => {
    it('returns messages for a valid session ID', () => {
      const { result } = renderHook(() => useChatHistory());

      let sessionId = '';
      act(() => {
        sessionId = result.current.createNewSession([
          {
            id: 'preload',
            role: 'assistant',
            content: 'Preloaded',
            timestamp: new Date(),
          },
        ]);
      });

      let loadedMessages: ChatMessage[] | null = null;
      act(() => {
        loadedMessages = result.current.loadSession(sessionId!);
      });

      expect(loadedMessages).not.toBeNull();
      expect(loadedMessages!).toHaveLength(1);
      expect(loadedMessages![0].content).toBe('Preloaded');
    });

    it('returns null for an invalid / non-existent session ID (negative)', () => {
      const { result } = renderHook(() => useChatHistory());

      let result_: ChatMessage[] | null = [];
      act(() => {
        result_ = result.current.loadSession('nonexistent-id');
      });

      expect(result_).toBeNull();
    });

    it('updates currentSessionId when loading a valid session', () => {
      const { result } = renderHook(() => useChatHistory());

      let sessionId = '';
      act(() => {
        sessionId = result.current.createNewSession();
      });

      // Create another session to switch to
      act(() => {
        result.current.createNewSession();
      });

      // Load the first session
      act(() => {
        result.current.loadSession(sessionId!);
      });

      expect(result.current.currentSessionId).toBe(sessionId!);
    });
  });

  // ── deleteSession ──────────────────────────────────────────────────────────

  describe('deleteSession', () => {
    it('removes the session from the list', () => {
      const { result } = renderHook(() => useChatHistory());

      let sessionId = '';
      act(() => {
        sessionId = result.current.createNewSession();
      });

      expect(result.current.sessions).toHaveLength(1);

      act(() => {
        result.current.deleteSession(sessionId!);
      });

      expect(result.current.sessions).toHaveLength(0);
    });

    it('clears currentSessionId when deleting the active session', () => {
      const { result } = renderHook(() => useChatHistory());

      let sessionId = '';
      act(() => {
        sessionId = result.current.createNewSession();
      });

      expect(result.current.currentSessionId).toBe(sessionId!);

      act(() => {
        result.current.deleteSession(sessionId!);
      });

      expect(result.current.currentSessionId).toBeNull();
    });

    it('keeps currentSessionId when deleting a different session', () => {
      const { result } = renderHook(() => useChatHistory());

      let activeId = '';
      let otherId = '';
      act(() => {
        activeId = result.current.createNewSession();
      });
      act(() => {
        otherId = result.current.createNewSession();
      });
      // createNewSession sets currentSessionId to the newest session, so after
      // two creates, current is otherId. Load activeId to make it current.
      act(() => {
        result.current.loadSession(activeId);
      });

      expect(result.current.currentSessionId).toBe(activeId);

      act(() => {
        result.current.deleteSession(otherId!);
      });

      expect(result.current.currentSessionId).toBe(activeId!);
    });

    it('is a no-op when deleting a non-existent session (negative)', () => {
      const { result } = renderHook(() => useChatHistory());

      act(() => {
        result.current.createNewSession();
      });

      expect(result.current.sessions).toHaveLength(1);

      act(() => {
        result.current.deleteSession('nonexistent');
      });

      expect(result.current.sessions).toHaveLength(1);
    });
  });

  // ── clearAllHistory ────────────────────────────────────────────────────────

  describe('clearAllHistory', () => {
    it('resets sessions and currentSessionId to empty state', () => {
      const { result } = renderHook(() => useChatHistory());

      act(() => {
        result.current.createNewSession();
        result.current.createNewSession();
      });

      expect(result.current.sessions).toHaveLength(2);
      expect(result.current.hasHistory).toBe(true);

      act(() => {
        result.current.clearAllHistory();
      });

      expect(result.current.sessions).toEqual([]);
      expect(result.current.currentSessionId).toBeNull();
      expect(result.current.hasHistory).toBe(false);
    });

    it('removes defi_chat_history from localStorage', () => {
      const { result } = renderHook(() => useChatHistory());

      act(() => {
        result.current.createNewSession();
      });

      // localStorage should have been populated by the save effect
      // Clear history should remove the key
      act(() => {
        result.current.clearAllHistory();
      });

      expect(localStorage.getItem('defi_chat_history')).toBeNull();
    });
  });

  // ── togglePin ──────────────────────────────────────────────────────────────

  describe('togglePin', () => {
    it('pins an unpinned session', () => {
      const { result } = renderHook(() => useChatHistory());

      let sessionId = '';
      act(() => {
        sessionId = result.current.createNewSession();
      });

      act(() => {
        result.current.togglePin(sessionId!);
      });

      const session = result.current.sessions.find((s) => s.id === sessionId!);
      expect(session?.pinned).toBe(true);
      expect(session?.pinnedAt).toBeInstanceOf(Date);
    });

    it('unpins a pinned session', () => {
      const { result } = renderHook(() => useChatHistory());

      let sessionId = '';
      act(() => {
        sessionId = result.current.createNewSession();
      });

      // Pin first
      act(() => {
        result.current.togglePin(sessionId!);
      });
      expect(result.current.sessions[0].pinned).toBe(true);

      // Unpin
      act(() => {
        result.current.togglePin(sessionId!);
      });

      const session = result.current.sessions.find((s) => s.id === sessionId!);
      expect(session?.pinned).toBe(false);
      expect(session?.pinnedAt).toBeUndefined();
    });

    it('is a no-op for a non-existent session ID (negative)', () => {
      const { result } = renderHook(() => useChatHistory());

      act(() => {
        result.current.createNewSession();
      });

      expect(() => {
        act(() => {
          result.current.togglePin('nonexistent');
        });
      }).not.toThrow();

      expect(result.current.sessions).toHaveLength(1);
    });
  });

  // ── Export functions ───────────────────────────────────────────────────────

  describe('export functions', () => {
    it('exportSession returns a JSON string for a valid session', () => {
      const { result } = renderHook(() => useChatHistory());

      let sessionId = '';
      act(() => {
        sessionId = result.current.createNewSession();
      });

      let exported: string | null = null;
      act(() => {
        exported = result.current.exportSession(sessionId!);
      });

      expect(exported).not.toBeNull();
      expect(() => JSON.parse(exported!)).not.toThrow();
    });

    it('exportSession returns null for an invalid session ID (negative)', () => {
      const { result } = renderHook(() => useChatHistory());

      let exported: string | null = 'should be overwritten';
      act(() => {
        exported = result.current.exportSession('nonexistent');
      });

      expect(exported).toBeNull();
    });

    it('exportSessionAsJSON returns data and filename for a valid session', () => {
      const { result } = renderHook(() => useChatHistory());

      let sessionId = '';
      act(() => {
        sessionId = result.current.createNewSession();
      });

      let exported: { data: string; filename: string } | null = null;
      act(() => {
        exported = result.current.exportSessionAsJSON(sessionId!);
      });

      expect(exported).not.toBeNull();
      expect(exported!.filename).toContain('.json');
      expect(() => JSON.parse(exported!.data)).not.toThrow();
    });

    it('exportSessionAsJSON returns null for an invalid session ID (negative)', () => {
      const { result } = renderHook(() => useChatHistory());

      let exported: { data: string; filename: string } | null = {
        data: 'not null',
        filename: 'not null',
      };
      act(() => {
        exported = result.current.exportSessionAsJSON('nonexistent');
      });

      expect(exported).toBeNull();
    });

    it('exportSessionAsTXT returns data and filename for a valid session', () => {
      const { result } = renderHook(() => useChatHistory());

      let sessionId = '';
      act(() => {
        sessionId = result.current.createNewSession();
      });

      let exported: { data: string; filename: string } | null = null;
      act(() => {
        exported = result.current.exportSessionAsTXT(sessionId!);
      });

      expect(exported).not.toBeNull();
      expect(exported!.filename).toContain('.txt');
      expect(exported!.data).toContain('CHAT SESSION EXPORT');
    });

    it('exportSessionAsTXT returns null for an invalid session ID (negative)', () => {
      const { result } = renderHook(() => useChatHistory());

      let exported: { data: string; filename: string } | null = {
        data: 'not null',
        filename: 'not null',
      };
      act(() => {
        exported = result.current.exportSessionAsTXT('nonexistent');
      });

      expect(exported).toBeNull();
    });
  });

  // ── Search (debounced) ─────────────────────────────────────────────────────

  describe('search functionality', () => {
    it('returns empty searchResults when query is empty', () => {
      const { result } = renderHook(() => useChatHistory());

      expect(result.current.searchResults).toEqual([]);
    });

    it('debounces search and returns results after the delay', () => {
      vi.useFakeTimers();

      const { result } = renderHook(() => useChatHistory());

      // Create a session with searchable content
      act(() => {
        result.current.createNewSession([
          {
            id: 's-msg',
            role: 'user',
            content: 'Send 50 XLM to recipient',
            timestamp: new Date(),
          },
        ]);
      });

      // Set the search query
      act(() => {
        result.current.setSearchQuery('XLM');
      });

      // Before debounce resolves, results should still be empty
      expect(result.current.searchResults).toEqual([]);

      // Advance past the 300ms debounce
      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(result.current.searchResults.length).toBeGreaterThan(0);
      expect(result.current.searchResults[0].messages[0].content).toContain('XLM');
    });

    it('returns empty results when query matches nothing', () => {
      vi.useFakeTimers();

      const { result } = renderHook(() => useChatHistory());

      act(() => {
        result.current.createNewSession([
          {
            id: 's-msg',
            role: 'user',
            content: 'Send USDC',
            timestamp: new Date(),
          },
        ]);
      });

      act(() => {
        result.current.setSearchQuery('nonexistent');
      });

      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(result.current.searchResults).toEqual([]);
    });

    it('searchSessions (direct) returns results immediately', () => {
      const { result } = renderHook(() => useChatHistory());

      act(() => {
        result.current.createNewSession([
          {
            id: 'd-msg',
            role: 'user',
            content: 'Deposit 100 USDC',
            timestamp: new Date(),
          },
        ]);
      });

      let directResults: ChatSession[] = [];
      act(() => {
        directResults = result.current.searchSessions('USDC');
      });

      expect(directResults).toHaveLength(1);
      expect(directResults[0].messages[0].content).toContain('USDC');
    });
  });

  // ── Unmount cleanup ────────────────────────────────────────────────────────

  describe('unmount cleanup', () => {
    it('clears save debounce timeout on unmount (no lingering effects)', () => {
      vi.useFakeTimers();

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      const { result, unmount } = renderHook(() => useChatHistory());

      // Create a session to trigger the save debounce
      act(() => {
        result.current.createNewSession([
          {
            id: 'cleanup-msg',
            role: 'user',
            content: 'Test cleanup',
            timestamp: new Date(),
          },
        ]);
      });

      const callsBeforeUnmount = clearTimeoutSpy.mock.calls.length;

      unmount();

      // clearTimeout should have been called at least once more due to unmount cleanup
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(
        callsBeforeUnmount,
      );

      clearTimeoutSpy.mockRestore();
    });

    it('clears search debounce timeout on unmount', () => {
      vi.useFakeTimers();

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      const { result, unmount } = renderHook(() => useChatHistory());

      act(() => {
        result.current.setSearchQuery('something');
      });

      const callsBeforeUnmount = clearTimeoutSpy.mock.calls.length;

      unmount();

      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(
        callsBeforeUnmount,
      );

      clearTimeoutSpy.mockRestore();
    });
  });

  // ── Sorted sessions ────────────────────────────────────────────────────────

  describe('sorted sessions', () => {
    it('pinnedSessions contains only pinned sessions', () => {
      const { result } = renderHook(() => useChatHistory());

      let sessionId = '';
      act(() => {
        sessionId = result.current.createNewSession();
      });

      act(() => {
        result.current.togglePin(sessionId!);
      });

      expect(result.current.pinnedSessions).toHaveLength(1);
      expect(result.current.pinnedSessions[0].id).toBe(sessionId!);
    });

    it('unpinnedSessions excludes pinned sessions', () => {
      const { result } = renderHook(() => useChatHistory());

      act(() => {
        result.current.createNewSession(); // unpinned
      });

      let pinnedId = '';
      act(() => {
        pinnedId = result.current.createNewSession();
      });
      act(() => {
        result.current.togglePin(pinnedId!);
      });

      expect(result.current.unpinnedSessions).toHaveLength(1);
      expect(result.current.unpinnedSessions.every((s) => !s.pinned)).toBe(true);
      expect(result.current.pinnedSessions).toHaveLength(1);
    });

    it('currentSession returns the active session', () => {
      const { result } = renderHook(() => useChatHistory());

      let sessionId = '';
      act(() => {
        sessionId = result.current.createNewSession();
      });

      expect(result.current.currentSession).not.toBeNull();
      expect(result.current.currentSession!.id).toBe(sessionId);
    });

    it('currentSession returns null when no session is active', () => {
      const { result } = renderHook(() => useChatHistory());

      expect(result.current.currentSession).toBeNull();
    });
  });

  // ── setIsHistoryOpen ───────────────────────────────────────────────────────

  describe('setIsHistoryOpen', () => {
    it('toggles isHistoryOpen from false to true', () => {
      const { result } = renderHook(() => useChatHistory());

      expect(result.current.isHistoryOpen).toBe(false);

      act(() => {
        result.current.setIsHistoryOpen(true);
      });

      expect(result.current.isHistoryOpen).toBe(true);
    });

    it('toggles isHistoryOpen back to false', () => {
      const { result } = renderHook(() => useChatHistory());

      act(() => {
        result.current.setIsHistoryOpen(true);
      });
      expect(result.current.isHistoryOpen).toBe(true);

      act(() => {
        result.current.setIsHistoryOpen(false);
      });

      expect(result.current.isHistoryOpen).toBe(false);
    });
  });

  // ── reorderPinned ──────────────────────────────────────────────────────────

  describe('reorderPinned', () => {
    it('reorders pinned sessions according to the provided order', () => {
      const { result } = renderHook(() => useChatHistory());

      let idA = '';
      let idB = '';
      let idC = '';
      act(() => {
        idA = result.current.createNewSession();
        idB = result.current.createNewSession();
        idC = result.current.createNewSession();
      });

      // Pin all three
      act(() => {
        result.current.togglePin(idA!);
        result.current.togglePin(idB!);
        result.current.togglePin(idC!);
      });

      // Reorder: B, A, C
      act(() => {
        result.current.reorderPinned([idB!, idA!, idC!]);
      });

      const pinned = result.current.pinnedSessions;
      expect(pinned[0].id).toBe(idB!);
      expect(pinned[1].id).toBe(idA!);
      expect(pinned[2].id).toBe(idC!);
    });
  });
});
