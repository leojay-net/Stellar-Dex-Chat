'use client';

import { useState, useEffect, useCallback } from 'react';

const KEYBOARD_SHORTCUTS = {
  ADD_BENEFICIARY: 'Ctrl+B',
  FOCUS_BENEFICIARIES: 'Ctrl+Shift+B',
  NAVIGATE_UP: 'ArrowUp',
  NAVIGATE_DOWN: 'ArrowDown',
  SELECT_BENEFICIARY: 'Enter',
  DELETE_BENEFICIARY: 'Delete',
} as const;

export interface Beneficiary {
  id: string;
  name: string;
  bankId: number;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  createdAt: number;
}

const STORAGE_KEY = 'stellar_beneficiaries';

/**
 * Request deduplication system to prevent duplicate API calls.
 * Concurrent fetches for the same key share one in-flight promise,
 * with the result distributed to all waiters.
 */
class RequestDeduplicator {
  private inFlightRequests = new Map<string, Promise<Beneficiary[]>>();

  /**
   * Get or create a promise for the given key.
   * If a request is already in-flight, return the existing promise.
   */
  async fetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
  ): Promise<T> {
    // Check if a request is already in-flight
    if (this.inFlightRequests.has(key)) {
      return this.inFlightRequests.get(key) as Promise<T>;
    }

    // Create new promise and track it
    const promise = (async () => {
      try {
        const result = await fetchFn();
        return result;
      } finally {
        // Remove from tracking after completion (success or failure)
        this.inFlightRequests.delete(key);
      }
    })();

    this.inFlightRequests.set(key, promise as Promise<Beneficiary[]>);
    return promise;
  }
}

const deduplicator = new RequestDeduplicator();

function generateId(): string {
  return `ben_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Fetch beneficiaries from the API with request deduplication.
 * All concurrent requests for the same key will share the same in-flight promise.
 */
async function fetchBeneficiariesWithDedup(
  userId: string = 'current',
): Promise<Beneficiary[]> {
  return deduplicator.fetch(`beneficiaries:${userId}`, async () => {
    try {
      const response = await fetch(`/api/beneficiaries?userId=${encodeURIComponent(userId)}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Failed to fetch beneficiaries:', error);
      // Return empty array on error to allow graceful fallback
      return [];
    }
  });
}

export function useBeneficiaries(options?: { fetchFromApi?: boolean; userId?: string }) {
  const { fetchFromApi = false, userId = 'current' } = options || {};
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Fetch from API with deduplication if enabled
  useEffect(() => {
    if (!isMounted || !fetchFromApi || typeof window === 'undefined') return;

    let cancelled = false;

    (async () => {
      try {
        const data = await fetchBeneficiariesWithDedup(userId);
        if (!cancelled) {
          setBeneficiaries(Array.isArray(data) ? data : []);
          setIsLoaded(true);
        }
      } catch (error) {
        console.error('Error loading beneficiaries:', error);
        if (!cancelled) {
          setIsLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isMounted, fetchFromApi, userId]);

  // Load from localStorage if not fetching from API
  useEffect(() => {
    if (!isMounted || fetchFromApi || typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Beneficiary[];
        setBeneficiaries(Array.isArray(parsed) ? parsed : []);
      }
    } catch {
      setBeneficiaries([]);
    }
    setIsLoaded(true);
  }, [isMounted, fetchFromApi]);

  useEffect(() => {
    if (!isLoaded || typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(beneficiaries));
    } catch {
      // Silently fail if localStorage is unavailable
    }
  }, [beneficiaries, isLoaded]);

  const addBeneficiary = useCallback(
    (
      bankId: number,
      bankName: string,
      bankCode: string,
      accountNumber: string,
      accountName: string,
      customName?: string,
    ): Beneficiary => {
      const newBeneficiary: Beneficiary = {
        id: generateId(),
        name: customName || accountName,
        bankId,
        bankName,
        bankCode,
        accountNumber,
        accountName,
        createdAt: Date.now(),
      };
      setBeneficiaries((prev) => [...prev, newBeneficiary]);
      return newBeneficiary;
    },
    [],
  );

  const renameBeneficiary = useCallback((id: string, newName: string) => {
    setBeneficiaries((prev) =>
      prev.map((b) => (b.id === id ? { ...b, name: newName } : b)),
    );
  }, []);

  const deleteBeneficiary = useCallback((id: string) => {
    setBeneficiaries((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const getBeneficiary = useCallback(
    (id: string): Beneficiary | undefined => {
      return beneficiaries.find((b) => b.id === id);
    },
    [beneficiaries],
  );

  // Keyboard shortcuts handling
  const handleKeyboardShortcut = useCallback((event: KeyboardEvent) => {
    const { ctrlKey, shiftKey, key } = event;

    // Add beneficiary: Ctrl+B
    if (ctrlKey && !shiftKey && key === 'b') {
      event.preventDefault();
      // This would typically trigger a UI action to add beneficiary
      // For now, we'll just log or provide a callback
      return 'add';
    }

    // Focus beneficiaries: Ctrl+Shift+B
    if (ctrlKey && shiftKey && key === 'B') {
      event.preventDefault();
      return 'focus';
    }

    // Navigation: ArrowUp/ArrowDown when beneficiaries are focused
    if (key === 'ArrowUp' && selectedIndex > 0) {
      event.preventDefault();
      setSelectedIndex(selectedIndex - 1);
      return 'navigate-up';
    }

    if (key === 'ArrowDown' && selectedIndex < beneficiaries.length - 1) {
      event.preventDefault();
      setSelectedIndex(selectedIndex + 1);
      return 'navigate-down';
    }

    // Select: Enter
    if (key === 'Enter' && selectedIndex >= 0) {
      event.preventDefault();
      return 'select';
    }

    // Delete: Delete key
    if (key === 'Delete' && selectedIndex >= 0) {
      event.preventDefault();
      const beneficiaryToDelete = beneficiaries[selectedIndex];
      if (beneficiaryToDelete) {
        deleteBeneficiary(beneficiaryToDelete.id);
      }
      return 'delete';
    }

    return null;
  }, [selectedIndex, beneficiaries, deleteBeneficiary]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      handleKeyboardShortcut(event);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyboardShortcut]);

  const selectBeneficiary = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIndex(-1);
  }, []);

  return {
    beneficiaries,
    isLoaded,
    selectedIndex,
    addBeneficiary,
    renameBeneficiary,
    deleteBeneficiary,
    getBeneficiary,
    selectBeneficiary,
    clearSelection,
    keyboardShortcuts: KEYBOARD_SHORTCUTS,
  };
}
