'use client';

import React, { useMemo } from 'react';
import BottomSheet from '@/components/ui/BottomSheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { getFeatureFlag } from '@/lib/featureFlags';

export interface WalletActionHapticControls {
  confirm: () => void;
  error: () => void;
}

/**
 * Context to provide haptic actions to WalletActionSheet children.
 */
const WalletActionHapticsContext = React.createContext<WalletActionHapticControls | null>(null);

/**
 * Hook to read haptic controls from a WalletActionSheet instance.
 *
 * @returns Haptic controls for confirm/error action feedback.
 * @throws if used outside of WalletActionSheet provider boundary.
 */
export function useWalletActionHaptics(): WalletActionHapticControls {
  const context = React.useContext(WalletActionHapticsContext);
  if (!context) {
    throw new Error('useWalletActionHaptics must be used within WalletActionSheet');
  }
  return context;
}

interface WalletActionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  ariaLabel?: string;
  /** Optional confirm callback for action success events */
  onConfirm?: () => void;
  /** Optional error callback for action failure events */
  onError?: () => void;
  /** Optional ref forwarded to the desktop modal root */
  modalRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Responsive wrapper for wallet action dialogs.
 * - On mobile (< 640px): renders a swipeable bottom-sheet.
 * - On desktop (>= 640px): renders the existing centered modal pattern.
 */
export default function WalletActionSheet({
  isOpen,
  onClose,
  title,
  children,
  ariaLabel,
  onConfirm,
  onError,
  modalRef,
}: WalletActionSheetProps) {
  const isMobile = useMediaQuery('(max-width: 639px)');
  const enableHaptics = getFeatureFlag('enableHaptics');

  const haptics = useMemo<WalletActionHapticControls>(
    () => ({
      confirm: () => {
        if (enableHaptics) {
          navigator.vibrate?.([10]);
        }
        onConfirm?.();
      },
      error: () => {
        if (enableHaptics) {
          navigator.vibrate?.([50, 30, 50]);
        }
        onError?.();
      },
    }),
    [enableHaptics, onConfirm, onError],
  );

  if (!isOpen) return null;

  const content = isMobile ? (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      ariaLabel={ariaLabel}
    >
      {children}
    </BottomSheet>
  ) : (
    <div className="theme-overlay fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title}
        tabIndex={-1}
        className="theme-surface theme-border relative w-full max-w-md mx-4 border rounded-2xl shadow-2xl p-6"
        data-testid="wallet-action-modal"
      >
        {children}
      </div>
    </div>
  );

  return (
    <WalletActionHapticsContext.Provider value={haptics}>
      {content}
    </WalletActionHapticsContext.Provider>
  );
}
