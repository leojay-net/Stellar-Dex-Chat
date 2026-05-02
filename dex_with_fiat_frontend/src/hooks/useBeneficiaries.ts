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

function generateId(): string {
  return `ben_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function useBeneficiaries() {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || typeof window === 'undefined') return;
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
  }, [isMounted]);

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
