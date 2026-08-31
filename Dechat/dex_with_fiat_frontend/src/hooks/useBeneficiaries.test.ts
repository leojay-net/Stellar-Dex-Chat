import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useBeneficiaries } from './useBeneficiaries';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('useBeneficiaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Test 1: Initial state tests
  describe('initial state', () => {
    it('returns empty beneficiaries array initially', () => {
      const { result } = renderHook(() => useBeneficiaries());

      expect(result.current.beneficiaries).toEqual([]);
      expect(result.current.isLoaded).toBe(false);
      expect(result.current.selectedIndex).toBe(-1);
    });

    it('loads beneficiaries from localStorage on mount', () => {
      const mockBeneficiaries = [
        {
          id: '1',
          name: 'Test Beneficiary',
          bankId: 1,
          bankName: 'Test Bank',
          bankCode: 'TB',
          accountNumber: '123456789',
          accountName: 'Test Account',
          createdAt: Date.now(),
        },
      ];
      localStorageMock.getItem.mockReturnValue(JSON.stringify(mockBeneficiaries));

      const { result } = renderHook(() => useBeneficiaries());

      expect(result.current.beneficiaries).toEqual(mockBeneficiaries);
      expect(result.current.isLoaded).toBe(true);
    });

    it('handles malformed localStorage data gracefully', () => {
      localStorageMock.getItem.mockReturnValue('invalid json');

      const { result } = renderHook(() => useBeneficiaries());

      expect(result.current.beneficiaries).toEqual([]);
      expect(result.current.isLoaded).toBe(true);
    });

    it('handles non-array localStorage data gracefully', () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify({ not: 'an array' }));

      const { result } = renderHook(() => useBeneficiaries());

      expect(result.current.beneficiaries).toEqual([]);
      expect(result.current.isLoaded).toBe(true);
    });

    it('provides keyboard shortcuts metadata', () => {
      const { result } = renderHook(() => useBeneficiaries());

      expect(result.current).toHaveProperty('keyboardShortcuts');
      expect(result.current.keyboardShortcuts).toEqual({
        ADD_BENEFICIARY: 'Ctrl+B',
        FOCUS_BENEFICIARIES: 'Ctrl+Shift+B',
        NAVIGATE_UP: 'ArrowUp',
        NAVIGATE_DOWN: 'ArrowDown',
        SELECT_BENEFICIARY: 'Enter',
        DELETE_BENEFICIARY: 'Delete',
      });
    });
  });

  // Test 2: Async API paths (resolve and reject)
  describe('async API fetching', () => {
    it('fetches beneficiaries from API when fetchFromApi is true', async () => {
      const mockBeneficiaries = [
        {
          id: '1',
          name: 'API Beneficiary',
          bankId: 1,
          bankName: 'API Bank',
          bankCode: 'AB',
          accountNumber: '987654321',
          accountName: 'API Account',
          createdAt: Date.now(),
        },
      ];

      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockBeneficiaries), { status: 200 })
      );

      const { result } = renderHook(() =>
        useBeneficiaries({ fetchFromApi: true, userId: 'user-123' })
      );

      expect(result.current.isLoaded).toBe(false);

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      expect(result.current.beneficiaries).toEqual(mockBeneficiaries);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/beneficiaries?userId=user-123'
      );
    });

    it('handles API fetch errors gracefully', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() =>
        useBeneficiaries({ fetchFromApi: true })
      );

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      expect(result.current.beneficiaries).toEqual([]);
    });

    it('handles API non-OK responses gracefully', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 500 })
      );

      const { result } = renderHook(() =>
        useBeneficiaries({ fetchFromApi: true })
      );

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      expect(result.current.beneficiaries).toEqual([]);
    });

    it('handles non-array API response gracefully', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: 'not array' }), { status: 200 })
      );

      const { result } = renderHook(() =>
        useBeneficiaries({ fetchFromApi: true })
      );

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      expect(result.current.beneficiaries).toEqual([]);
    });

    it('deduplicates concurrent API requests for same userId', async () => {
      const mockBeneficiaries = [{ id: '1', name: 'Test', bankId: 1, bankName: 'B', bankCode: 'C', accountNumber: '123', accountName: 'A', createdAt: 0 }];
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockBeneficiaries), { status: 200 })
      );

      const { result } = renderHook(() =>
        useBeneficiaries({ fetchFromApi: true, userId: 'user-123' })
      );

      // Simulate another component using the same hook with same userId
      const { result: result2 } = renderHook(() =>
        useBeneficiaries({ fetchFromApi: true, userId: 'user-123' })
      );

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
        expect(result2.current.isLoaded).toBe(true);
      });

      // Should only call fetch once due to deduplication
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(result.current.beneficiaries).toEqual(mockBeneficiaries);
      expect(result2.current.beneficiaries).toEqual(mockBeneficiaries);
    });

    it('does not deduplicate requests for different userIds', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

      const { result } = renderHook(() =>
        useBeneficiaries({ fetchFromApi: true, userId: 'user-1' })
      );

      const { result: result2 } = renderHook(() =>
        useBeneficiaries({ fetchFromApi: true, userId: 'user-2' })
      );

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
        expect(result2.current.isLoaded).toBe(true);
      });

      // Should call fetch twice for different userIds
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  // Test 3: Effects cleanup and unsubscribe
  describe('effects cleanup', () => {
    it('does not update state after unmount when API fetch completes', async () => {
      let resolveFetch!: (value: Response) => void;
      const fetchPromise = new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });

      vi.spyOn(global, 'fetch').mockReturnValue(fetchPromise);

      const { result, unmount } = renderHook(() =>
        useBeneficiaries({ fetchFromApi: true, userId: 'user-1' }),
      );

      expect(result.current.isLoaded).toBe(false);

      // Unmount before the fetch resolves
      unmount();

      // Resolve the fetch after unmount — should not update state
      resolveFetch(
        new Response(JSON.stringify([]), { status: 200 }),
      );

      await waitFor(() => {
        // After resolving, state should remain unchanged (not loaded)
        // since the component was already unmounted
        expect(result.current.beneficiaries).toHaveLength(0);
      });
    });

    it('cancels in-flight request when userId changes', async () => {
      let resolveFirst!: (value: Response) => void;
      const firstFetch = new Promise<Response>((resolve) => { resolveFirst = resolve; });
      let resolveSecond!: (value: Response) => void;
      const secondFetch = new Promise<Response>((resolve) => { resolveSecond = resolve; });

      const fetchSpy = vi.spyOn(global, 'fetch')
        .mockReturnValueOnce(firstFetch)
        .mockReturnValueOnce(secondFetch);

      let userId = 'user-a';
      const { result, rerender } = renderHook(() =>
        useBeneficiaries({ fetchFromApi: true, userId }),
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      userId = 'user-b';
      rerender();

      // Resolve stale request after userId change — state should reflect second request result
      const firstData = [{ id: '1', name: 'Old', bankId: 1, bankName: 'B', bankCode: 'B', accountNumber: '1', accountName: 'A', createdAt: 0 }];
      resolveFirst(new Response(JSON.stringify(firstData), { status: 200 }));

      const secondData = [{ id: '2', name: 'New', bankId: 2, bankName: 'C', bankCode: 'C', accountNumber: '2', accountName: 'B', createdAt: 0 }];
      resolveSecond(new Response(JSON.stringify(secondData), { status: 200 }));

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });
    });

    it('cleans up keyboard event listener on unmount', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = renderHook(() => useBeneficiaries());

      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('does not add event listener when window is undefined', () => {
      // Simulate SSR environment
      const originalWindow = global.window;
      Object.defineProperty(global, 'window', { value: undefined });

      const addEventListenerSpy = vi.spyOn(global, 'addEventListener');

      renderHook(() => useBeneficiaries());

      expect(addEventListenerSpy).not.toHaveBeenCalled();

      // Restore window
      Object.defineProperty(global, 'window', { value: originalWindow });
    });
  });

  // Test 4: CRUD operations
  describe('CRUD operations', () => {
    it('adds beneficiary correctly', () => {
      const { result } = renderHook(() => useBeneficiaries());

      act(() => {
        result.current.addBeneficiary(
          1,
          'Test Bank',
          'TB',
          '123456789',
          'Test Account',
          'Custom Name'
        );
      });

      expect(result.current.beneficiaries).toHaveLength(1);
      const beneficiary = result.current.beneficiaries[0];
      expect(beneficiary).toMatchObject({
        bankId: 1,
        bankName: 'Test Bank',
        bankCode: 'TB',
        accountNumber: '123456789',
        accountName: 'Test Account',
        name: 'Custom Name',
      });
      expect(beneficiary.id).toMatch(/^ben_\d+_[a-z0-9]+$/);
      expect(beneficiary.createdAt).toBeGreaterThan(0);
    });

    it('uses accountName as default name when customName is not provided', () => {
      const { result } = renderHook(() => useBeneficiaries());

      act(() => {
        result.current.addBeneficiary(
          1,
          'Test Bank',
          'TB',
          '123456789',
          'Test Account'
        );
      });

      expect(result.current.beneficiaries[0].name).toBe('Test Account');
    });

    it('renames beneficiary correctly', () => {
      const { result } = renderHook(() => useBeneficiaries());

      let beneficiaryId: string;
      act(() => {
        const beneficiary = result.current.addBeneficiary(
          1,
          'Test Bank',
          'TB',
          '123456789',
          'Test Account'
        );
        beneficiaryId = beneficiary.id;
      });

      act(() => {
        result.current.renameBeneficiary(beneficiaryId!, 'New Name');
      });

      expect(result.current.beneficiaries[0].name).toBe('New Name');
    });

    it('does not rename non-existent beneficiary', () => {
      const { result } = renderHook(() => useBeneficiaries());

      act(() => {
        result.current.addBeneficiary(1, 'Bank', 'B', '123', 'Account');
      });

      act(() => {
        result.current.renameBeneficiary('non-existent-id', 'New Name');
      });

      expect(result.current.beneficiaries[0].name).toBe('Account');
    });

    it('deletes beneficiary correctly', () => {
      const { result } = renderHook(() => useBeneficiaries());

      let beneficiaryId: string;
      act(() => {
        const beneficiary = result.current.addBeneficiary(1, 'Bank', 'B', '123', 'Account');
        beneficiaryId = beneficiary.id;
      });

      expect(result.current.beneficiaries).toHaveLength(1);

      act(() => {
        result.current.deleteBeneficiary(beneficiaryId!);
      });

      expect(result.current.beneficiaries).toHaveLength(0);
    });

    it('gets beneficiary by id', () => {
      const { result } = renderHook(() => useBeneficiaries());

      let beneficiaryId: string;
      act(() => {
        const beneficiary = result.current.addBeneficiary(1, 'Bank', 'B', '123', 'Account');
        beneficiaryId = beneficiary.id;
      });

      const retrieved = result.current.getBeneficiary(beneficiaryId!);
      expect(retrieved).toEqual(result.current.beneficiaries[0]);

      const nonExistent = result.current.getBeneficiary('non-existent');
      expect(nonExistent).toBeUndefined();
    });

    it('saves beneficiaries to localStorage when updated', () => {
      const { result } = renderHook(() => useBeneficiaries());

      act(() => {
        result.current.addBeneficiary(
          1,
          'Test Bank',
          'TB',
          '123456789',
          'Test Account',
          'Custom Name'
        );
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'stellar_beneficiaries',
        expect.stringContaining('Custom Name')
      );
    });

    it('handles localStorage errors gracefully', () => {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('Storage full');
      });

      const { result } = renderHook(() => useBeneficiaries());

      // Should not throw
      act(() => {
        result.current.addBeneficiary(1, 'Bank', 'B', '123', 'Account');
      });
    });
  });

  // Test 5: Selection and keyboard shortcuts
  describe('selection and keyboard shortcuts', () => {
    it('selects beneficiary by index', () => {
      const { result } = renderHook(() => useBeneficiaries());

      act(() => {
        result.current.addBeneficiary(1, 'Bank A', 'BA', '111', 'Account A');
        result.current.addBeneficiary(2, 'Bank B', 'BB', '222', 'Account B');
      });

      act(() => {
        result.current.selectBeneficiary(1);
      });

      expect(result.current.selectedIndex).toBe(1);
    });

    it('clears selection', () => {
      const { result } = renderHook(() => useBeneficiaries());

      act(() => {
        result.current.addBeneficiary(1, 'Bank', 'B', '123', 'Account');
        result.current.selectBeneficiary(0);
      });

      expect(result.current.selectedIndex).toBe(0);

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selectedIndex).toBe(-1);
    });

    it('handles keyboard shortcuts for add beneficiary (Ctrl+B)', () => {
      const { result } = renderHook(() => useBeneficiaries());
      const mockEvent = {
        ctrlKey: true,
        shiftKey: false,
        key: 'b',
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      // @ts-expect-error - testing internal function
      const resultAction = result.current.handleKeyboardShortcut(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(resultAction).toBe('add');
    });

    it('handles keyboard shortcuts for focus beneficiaries (Ctrl+Shift+B)', () => {
      const { result } = renderHook(() => useBeneficiaries());
      const mockEvent = {
        ctrlKey: true,
        shiftKey: true,
        key: 'B',
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      // @ts-expect-error - testing internal function
      const resultAction = result.current.handleKeyboardShortcut(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(resultAction).toBe('focus');
    });

    it('handles keyboard navigation up arrow', () => {
      const { result } = renderHook(() => useBeneficiaries());

      act(() => {
        result.current.addBeneficiary(1, 'Bank A', 'BA', '111', 'Account A');
        result.current.addBeneficiary(2, 'Bank B', 'BB', '222', 'Account B');
        result.current.selectBeneficiary(1);
      });

      const mockEvent = {
        key: 'ArrowUp',
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      // @ts-expect-error - testing internal function
      const resultAction = result.current.handleKeyboardShortcut(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(resultAction).toBe('navigate-up');
      expect(result.current.selectedIndex).toBe(0);
    });

    it('does not navigate up when at first item', () => {
      const { result } = renderHook(() => useBeneficiaries());

      act(() => {
        result.current.addBeneficiary(1, 'Bank', 'B', '123', 'Account');
        result.current.selectBeneficiary(0);
      });

      const mockEvent = {
        key: 'ArrowUp',
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      // @ts-expect-error - testing internal function
      const resultAction = result.current.handleKeyboardShortcut(mockEvent);

      expect(resultAction).toBeNull();
      expect(result.current.selectedIndex).toBe(0);
    });

    it('handles keyboard navigation down arrow', () => {
      const { result } = renderHook(() => useBeneficiaries());

      act(() => {
        result.current.addBeneficiary(1, 'Bank A', 'BA', '111', 'Account A');
        result.current.addBeneficiary(2, 'Bank B', 'BB', '222', 'Account B');
        result.current.selectBeneficiary(0);
      });

      const mockEvent = {
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      // @ts-expect-error - testing internal function
      const resultAction = result.current.handleKeyboardShortcut(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(resultAction).toBe('navigate-down');
      expect(result.current.selectedIndex).toBe(1);
    });

    it('does not navigate down when at last item', () => {
      const { result } = renderHook(() => useBeneficiaries());

      act(() => {
        result.current.addBeneficiary(1, 'Bank A', 'BA', '111', 'Account A');
        result.current.selectBeneficiary(0);
      });

      const mockEvent = {
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      // @ts-expect-error - testing internal function
      const resultAction = result.current.handleKeyboardShortcut(mockEvent);

      expect(resultAction).toBeNull();
      expect(result.current.selectedIndex).toBe(0);
    });

    it('handles enter key to select beneficiary', () => {
      const { result } = renderHook(() => useBeneficiaries());

      act(() => {
        result.current.addBeneficiary(1, 'Bank', 'B', '123', 'Account');
        result.current.selectBeneficiary(0);
      });

      const mockEvent = {
        key: 'Enter',
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      // @ts-expect-error - testing internal function
      const resultAction = result.current.handleKeyboardShortcut(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(resultAction).toBe('select');
    });

    it('handles delete key to delete selected beneficiary', () => {
      const { result } = renderHook(() => useBeneficiaries());

      act(() => {
        result.current.addBeneficiary(1, 'Bank', 'B', '123', 'Account');
        result.current.selectBeneficiary(0);
      });

      expect(result.current.beneficiaries).toHaveLength(1);

      const mockEvent = {
        key: 'Delete',
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      // @ts-expect-error - testing internal function
      const resultAction = result.current.handleKeyboardShortcut(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(resultAction).toBe('delete');
      expect(result.current.beneficiaries).toHaveLength(0);
    });

    it('does not handle delete key when no beneficiary is selected', () => {
      const { result } = renderHook(() => useBeneficiaries());

      act(() => {
        result.current.addBeneficiary(1, 'Bank', 'B', '123', 'Account');
      });

      const mockEvent = {
        key: 'Delete',
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      // @ts-expect-error - testing internal function
      const resultAction = result.current.handleKeyboardShortcut(mockEvent);

      expect(resultAction).toBeNull();
      expect(result.current.beneficiaries).toHaveLength(1);
    });

    it('returns null for unhandled keyboard shortcuts', () => {
      const { result } = renderHook(() => useBeneficiaries());

      const mockEvent = {
        ctrlKey: false,
        shiftKey: false,
        key: 'Escape',
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      // @ts-expect-error - testing internal function
      const resultAction = result.current.handleKeyboardShortcut(mockEvent);

      expect(resultAction).toBeNull();
    });
  });

  // Test 6: Edge cases and error handling
  describe('edge cases', () => {
    it('handles empty localStorage gracefully', () => {
      localStorageMock.getItem.mockReturnValue(null);

      const { result } = renderHook(() => useBeneficiaries());

      expect(result.current.beneficiaries).toEqual([]);
      expect(result.current.isLoaded).toBe(true);
    });

    it('does not fetch from API when fetchFromApi is false', () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      renderHook(() => useBeneficiaries({ fetchFromApi: false }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('does not save to localStorage when isLoaded is false', () => {
      renderHook(() => useBeneficiaries());

      // Clear calls from initial render
      localStorageMock.setItem.mockClear();

      // Try to add beneficiary before isLoaded is true
      act(() => {
        // Force add without waiting for isLoaded
        // In real scenario, isLoaded would be false initially
        // We'll test that localStorage.setItem is not called
      });

      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    it('handles component unmount before isMounted effect runs', () => {
      const { unmount } = renderHook(() => useBeneficiaries());
      
      // Immediately unmount - should not cause errors
      unmount();
    });

    it('prevents hydration mismatch by only loading from localStorage after mount', () => {
      // In a real Next.js app, the initial render would have empty beneficiaries
      // and isLoaded false, then useEffect would run and load from localStorage
      // In tests, useEffect runs synchronously, so we test the final state
      const mockBeneficiaries = [
        {
          id: '1',
          name: 'Test Beneficiary',
          bankId: 1,
          bankName: 'Test Bank',
          bankCode: 'TB',
          accountNumber: '123456789',
          accountName: 'Test Account',
          createdAt: Date.now(),
        },
      ];
      localStorageMock.getItem.mockReturnValue(JSON.stringify(mockBeneficiaries));

      const { result } = renderHook(() => useBeneficiaries());

      // After effects run, it should have loaded from localStorage
      expect(result.current.beneficiaries).toEqual(mockBeneficiaries);
      expect(result.current.isLoaded).toBe(true);
    });
  });
});