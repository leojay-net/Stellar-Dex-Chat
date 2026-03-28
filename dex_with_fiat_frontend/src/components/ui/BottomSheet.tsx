'use client';

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAccessibleModal } from '@/hooks/useAccessibleModal';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Optional aria-label override for the dialog */
  ariaLabel?: string;
}

const SWIPE_THRESHOLD = 80;

/**
 * Mobile bottom-sheet pattern for wallet actions on small screens.
 * Renders as a slide-up sheet with swipe-to-close on touch devices.
 * Includes an accessible close button as fallback.
 */
export default function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  ariaLabel,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ startY: 0, currentY: 0, dragging: false });
  const [translateY, setTranslateY] = useState(0);
  const [isClosing, setIsClosing] = useState(false);

  useAccessibleModal(isOpen && !isClosing, sheetRef, onClose);

  const animateClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      setTranslateY(0);
      onClose();
    }, 300);
  }, [onClose]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragRef.current.startY = e.touches[0].clientY;
    dragRef.current.dragging = true;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current.dragging) return;
    const diff = e.touches[0].clientY - dragRef.current.startY;
    // Only allow dragging downward
    if (diff > 0) {
      setTranslateY(diff);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    dragRef.current.dragging = false;
    if (translateY > SWIPE_THRESHOLD) {
      animateClose();
    } else {
      setTranslateY(0);
    }
  }, [translateY, animateClose]);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setTranslateY(0);
      setIsClosing(false);
    }
  }, [isOpen]);

  if (!isOpen && !isClosing) return null;

  const sheetTransform = isClosing
    ? 'translateY(100%)'
    : `translateY(${translateY}px)`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center backdrop-blur-sm bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) animateClose();
      }}
      data-testid="bottom-sheet-overlay"
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title}
        tabIndex={-1}
        className="theme-surface theme-border w-full max-w-lg border-t border-x rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col"
        style={{
          transform: sheetTransform,
          transition: translateY === 0 || isClosing ? 'transform 0.3s ease-out' : 'none',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        data-testid="bottom-sheet"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div
            className="w-10 h-1 rounded-full bg-gray-500"
            data-testid="bottom-sheet-drag-handle"
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pb-4 pt-2">
          <h2 className="theme-text-primary text-lg font-semibold">{title}</h2>
          <button
            onClick={animateClose}
            aria-label="Close"
            className="theme-text-muted hover:theme-text-primary transition-colors p-1 rounded-lg"
            data-testid="bottom-sheet-close-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 pb-6 scrollable-content">
          {children}
        </div>
      </div>
    </div>
  );
}
