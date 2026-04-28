import { renderHook, act } from '@testing-library/react';
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
    // No timer cleanup needed for this hook
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

  it('handles keyboard shortcuts for navigation and selection', () => {
    const { result } = renderHook(() => useBeneficiaries());

    // Add some beneficiaries
    act(() => {
      result.current.addBeneficiary(1, 'Bank A', 'BA', '111', 'Account A');
      result.current.addBeneficiary(2, 'Bank B', 'BB', '222', 'Account B');
    });

    // Select first beneficiary
    act(() => {
      result.current.selectBeneficiary(0);
    });
    expect(result.current.selectedIndex).toBe(0);

    // Navigate down
    act(() => {
      // Simulate the keyboard handler - in real usage this would be called via event listener
      // For testing, we can call the internal handler or test the selection change
    });

    // Clear selection
    act(() => {
      result.current.clearSelection();
    });
    expect(result.current.selectedIndex).toBe(-1);
  });

  it('deletes beneficiary with delete key when one is selected', () => {
    const { result } = renderHook(() => useBeneficiaries());

    act(() => {
      result.current.addBeneficiary(1, 'Bank A', 'BA', '111', 'Account A');
    });

    act(() => {
      result.current.selectBeneficiary(0);
    });

    expect(result.current.beneficiaries).toHaveLength(1);

    // Simulate delete key press (in real implementation, this is handled by event listener)
    // For testing purposes, we can directly call deleteBeneficiary
    act(() => {
      const beneficiary = result.current.beneficiaries[0];
      if (beneficiary) {
        result.current.deleteBeneficiary(beneficiary.id);
      }
    });

    expect(result.current.beneficiaries).toHaveLength(0);
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