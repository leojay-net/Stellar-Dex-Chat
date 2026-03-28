'use client';

import React from 'react';
import BottomSheet from '@/components/ui/BottomSheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';

interface WalletActionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  ariaLabel?: string;
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
  modalRef,
}: WalletActionSheetProps) {
  const isMobile = useMediaQuery('(max-width: 639px)');

  if (!isOpen) return null;

  if (isMobile) {
    return (
      <BottomSheet
        isOpen={isOpen}
        onClose={onClose}
        title={title}
        ariaLabel={ariaLabel}
      >
        {children}
      </BottomSheet>
    );
  }

  // Desktop: existing modal pattern
  return (
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
}
