'use client';

import { useEffect, useRef, RefObject } from 'react';
import { toastStore } from '@/lib/toastStore';

/**
 * User-facing message shown when the focus trap cannot take hold, so keyboard
 * and screen-reader users are told what happened instead of silently losing
 * their place. Exported so tests and callers can assert on it.
 */
export const FOCUS_TRAP_FAILURE_MESSAGE =
  'This dialog could not capture keyboard focus. Press Tab to reach its controls, or Escape to close it.';

/** Options for {@link useAccessibleModal}. */
export interface AccessibleModalOptions {
  /**
   * Called when the modal cannot be made keyboard-accessible (its container
   * never mounted, or it contains nothing focusable). Defaults to raising an
   * error toast carrying {@link FOCUS_TRAP_FAILURE_MESSAGE}.
   */
  onError?: (message: string) => void;
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'),
  );
}

// ── Body scroll lock ──────────────────────────────────────────────────────
//
// The lock is reference-counted at module scope rather than snapshotted per
// effect. A per-effect snapshot is unsafe because the value it reads back may
// have been written by *another* live modal (or by an earlier run of the same
// effect), in which case the last cleanup to run restores `'hidden'` and leaves
// the page permanently unscrollable. Only the first acquire records the real
// pre-modal value, and only the last release restores it.

let scrollLockCount = 0;
let scrollLockPreviousOverflow = '';

function acquireScrollLock(): void {
  if (scrollLockCount === 0) {
    scrollLockPreviousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function releaseScrollLock(): void {
  if (scrollLockCount === 0) {
    return;
  }
  scrollLockCount -= 1;
  if (scrollLockCount === 0) {
    document.body.style.overflow = scrollLockPreviousOverflow;
    scrollLockPreviousOverflow = '';
  }
}

/**
 * Trap focus inside an open modal, lock background scrolling, close on
 * `Escape`, and hand focus back to whatever opened it.
 *
 * ## Lifecycle
 *
 * All of the above is keyed on `isOpen` alone. `onClose` is read through a ref
 * so an unstable callback (the common `onClose={() => setOpen(false)}` case)
 * cannot tear the effect down and set it up again mid-interaction — a re-setup
 * would re-snapshot the scroll lock, yank focus back to the first control, and
 * bounce focus through the trigger on the way past.
 *
 * ## Error paths
 *
 * If the container never mounts, or holds nothing focusable and cannot itself
 * receive focus, the trap cannot work. Rather than failing silently, that is
 * reported through {@link AccessibleModalOptions.onError} (an error toast by
 * default) so the user is told the dialog is not keyboard-navigable.
 *
 * @param isOpen - Whether the modal is currently open.
 * @param containerRef - Ref to the modal's root element.
 * @param onClose - Invoked when the user presses `Escape`. May change identity
 *   between renders; the latest value is always used.
 * @param options - See {@link AccessibleModalOptions}.
 */
export function useAccessibleModal(
  isOpen: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  options?: AccessibleModalOptions,
) {
  // Keep the latest callbacks reachable from the effect without listing them as
  // dependencies — that is what makes the effect run once per open/close.
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(options?.onError);

  useEffect(() => {
    onCloseRef.current = onClose;
    onErrorRef.current = options?.onError;
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousActive = document.activeElement as HTMLElement | null;
    acquireScrollLock();

    let disposed = false;
    let retryFrame: number | null = null;
    let errorReported = false;

    const reportError = () => {
      if (errorReported) {
        return;
      }
      errorReported = true;
      const handler = onErrorRef.current;
      if (handler) {
        handler(FOCUS_TRAP_FAILURE_MESSAGE);
        return;
      }
      toastStore.addToast({
        message: FOCUS_TRAP_FAILURE_MESSAGE,
        severity: 'error',
      });
    };

    const applyInitialFocus = (isRetry: boolean) => {
      if (disposed) {
        return;
      }

      const container = containerRef.current;
      if (!container) {
        // The container can legitimately mount a frame late (animated sheets).
        // Give it exactly one frame before declaring the trap unusable.
        if (isRetry) {
          reportError();
          return;
        }
        retryFrame = requestAnimationFrame(() => {
          retryFrame = null;
          applyInitialFocus(true);
        });
        return;
      }

      const focusable = getFocusable(container);
      if (focusable.length > 0) {
        focusable[0].focus();
        return;
      }

      container.focus();
      if (document.activeElement !== container) {
        // Nothing to focus and the container itself refused focus (no
        // tabindex), so keyboard users have no way into the dialog.
        reportError();
      }
    };

    applyInitialFocus(false);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !containerRef.current) {
        return;
      }

      const focusable = getFocusable(containerRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        reportError();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement as HTMLElement | null;

      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      disposed = true;
      if (retryFrame !== null) {
        cancelAnimationFrame(retryFrame);
      }
      document.removeEventListener('keydown', onKeyDown);
      releaseScrollLock();

      // Only hand focus back if the opener is still in the document. Calling
      // focus() on a detached node is a silent no-op that would strand focus
      // on the closing modal's own controls, so blur out to the document
      // instead and keep the fallback predictable.
      if (previousActive && previousActive.isConnected) {
        previousActive.focus();
      } else {
        const active = document.activeElement;
        if (active instanceof HTMLElement) {
          active.blur();
        }
      }
    };
  }, [containerRef, isOpen]);
}
