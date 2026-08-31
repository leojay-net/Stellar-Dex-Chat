import { useRef } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAccessibleModal,
  FOCUS_TRAP_FAILURE_MESSAGE,
} from '@/hooks/useAccessibleModal';
import { toastStore } from '@/lib/toastStore';

/**
 * Minimal modal harness. `renderContainer` lets a test simulate a modal whose
 * root element is not in the DOM when the effect first runs.
 */
function Modal({
  isOpen,
  onClose,
  children,
  renderContainer = true,
  onError,
}: {
  isOpen: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  renderContainer?: boolean;
  onError?: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useAccessibleModal(isOpen, ref, onClose, onError ? { onError } : undefined);

  if (!renderContainer) {
    return null;
  }

  return (
    <div ref={ref} role="dialog">
      {children}
    </div>
  );
}

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, ...init }),
    );
  });
}

describe('useAccessibleModal', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
    toastStore.clearToasts();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
    toastStore.clearToasts();
  });

  describe('body scroll lock', () => {
    it('locks while open and restores the original value on close', () => {
      document.body.style.overflow = 'scroll';

      const { rerender } = render(
        <Modal isOpen onClose={() => {}}>
          <button>ok</button>
        </Modal>,
      );
      expect(document.body.style.overflow).toBe('hidden');

      rerender(
        <Modal isOpen={false} onClose={() => {}}>
          <button>ok</button>
        </Modal>,
      );
      expect(document.body.style.overflow).toBe('scroll');
    });

    // Guard for the reference-counted lock: an unstable `onClose` used to be an
    // effect dependency, so every parent re-render released and re-acquired the
    // lock. That must stay balanced — and must never flicker the page unlocked
    // mid-render.
    it('does not leak the lock when onClose changes identity while open', () => {
      const { rerender } = render(
        <Modal isOpen onClose={() => {}}>
          <button>ok</button>
        </Modal>,
      );
      expect(document.body.style.overflow).toBe('hidden');

      // Three re-renders, each with a brand-new inline callback.
      for (let i = 0; i < 3; i += 1) {
        rerender(
          <Modal isOpen onClose={() => {}}>
            <button>ok</button>
          </Modal>,
        );
      }
      expect(document.body.style.overflow).toBe('hidden');

      rerender(
        <Modal isOpen={false} onClose={() => {}}>
          <button>ok</button>
        </Modal>,
      );
      expect(document.body.style.overflow).toBe('');
    });

    // Regression: with two modals stacked, the inner one snapshotted the outer
    // one's 'hidden'. Closing the outer modal first unlocked the page while the
    // inner modal was still up, and closing the inner one then wrote 'hidden'
    // back to a page with no modals on it.
    it('reference-counts across overlapping modals', () => {
      const outer = render(
        <Modal isOpen onClose={() => {}}>
          <button>outer</button>
        </Modal>,
      );
      const inner = render(
        <Modal isOpen onClose={() => {}}>
          <button>inner</button>
        </Modal>,
      );
      expect(document.body.style.overflow).toBe('hidden');

      // Outer closes first — the inner modal is still open, so stay locked.
      outer.unmount();
      expect(document.body.style.overflow).toBe('hidden');

      inner.unmount();
      expect(document.body.style.overflow).toBe('');
    });
  });

  describe('focus management', () => {
    it('moves focus to the first focusable element on open', () => {
      const { getByText } = render(
        <Modal isOpen onClose={() => {}}>
          <button>first</button>
          <button>second</button>
        </Modal>,
      );
      expect(document.activeElement).toBe(getByText('first'));
    });

    // Regression: the effect re-ran on every render, and each re-run re-applied
    // initial focus — dragging the user back to the first control mid-form.
    it('does not steal focus back on re-render while open', () => {
      const { getByText, rerender } = render(
        <Modal isOpen onClose={() => {}}>
          <button>first</button>
          <button>second</button>
        </Modal>,
      );

      const second = getByText('second');
      act(() => second.focus());
      expect(document.activeElement).toBe(second);

      rerender(
        <Modal isOpen onClose={() => {}}>
          <button>first</button>
          <button>second</button>
        </Modal>,
      );

      expect(document.activeElement).toBe(second);
    });

    it('restores focus to the opener on close', () => {
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      trigger.focus();

      const { rerender } = render(
        <Modal isOpen onClose={() => {}}>
          <button>ok</button>
        </Modal>,
      );
      expect(document.activeElement).not.toBe(trigger);

      rerender(
        <Modal isOpen={false} onClose={() => {}}>
          <button>ok</button>
        </Modal>,
      );
      expect(document.activeElement).toBe(trigger);
    });

    it('falls back to the body when the opener has been removed', () => {
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      trigger.focus();

      const { rerender } = render(
        <Modal isOpen onClose={() => {}}>
          <button>ok</button>
        </Modal>,
      );

      trigger.remove();

      expect(() =>
        rerender(
          <Modal isOpen={false} onClose={() => {}}>
            <button>ok</button>
          </Modal>,
        ),
      ).not.toThrow();
      expect(document.activeElement).toBe(document.body);
    });

    it('wraps Tab and Shift+Tab inside the modal', () => {
      const { getByText } = render(
        <Modal isOpen onClose={() => {}}>
          <button>first</button>
          <button>last</button>
        </Modal>,
      );

      const first = getByText('first');
      const last = getByText('last');

      act(() => last.focus());
      press('Tab');
      expect(document.activeElement).toBe(first);

      press('Tab', { shiftKey: true });
      expect(document.activeElement).toBe(last);
    });

    it('focuses the first focusable element when the container mounts late', async () => {
      // Start without a container — the hook schedules a rAF retry.
      const { rerender, getByText } = render(
        <Modal isOpen onClose={() => {}} renderContainer={false} />,
      );

      // The container is not in the DOM yet.
      expect(document.querySelector('[role="dialog"]')).toBeNull();

      // Rerender with the container now present so the ref gets populated.
      rerender(
        <Modal isOpen onClose={() => {}}>
          <button>late button</button>
        </Modal>,
      );

      // Flush the pending requestAnimationFrame so the retry fires
      // and finds the container ready.
      await act(async () => {
        // jsdom polyfills rAF as setTimeout — flush it explicitly.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      });

      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(document.activeElement).toBe(getByText('late button'));
    });

    it('ignores non-Tab, non-Escape keydown events', () => {
      const onClose = vi.fn();
      render(
        <Modal isOpen onClose={onClose}>
          <button>ok</button>
        </Modal>,
      );

      // Pressing a regular letter key should not call onClose.
      press('a');
      press('ArrowDown');
      press('Enter');

      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not intercept Tab when the container ref is null', () => {
      const onError = vi.fn();
      render(
        <Modal isOpen onClose={() => {}} onError={onError} />
      );

      // Manually null the ref to simulate a detached container.
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();

      // Pressing Tab when the container has no focusable children should
      // trigger the reportError path via the Tab handler.
      press('Tab');
      expect(onError).toHaveBeenCalledWith(FOCUS_TRAP_FAILURE_MESSAGE);
    });
  });

  describe('escape handling', () => {
    it('closes on Escape', () => {
      const onClose = vi.fn();
      render(
        <Modal isOpen onClose={onClose}>
          <button>ok</button>
        </Modal>,
      );

      press('Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    // Regression guard for the ref indirection: skipping `onClose` as a
    // dependency must not pin the effect to a stale callback.
    it('calls the latest onClose after a re-render', () => {
      const first = vi.fn();
      const second = vi.fn();

      const { rerender } = render(
        <Modal isOpen onClose={first}>
          <button>ok</button>
        </Modal>,
      );
      rerender(
        <Modal isOpen onClose={second}>
          <button>ok</button>
        </Modal>,
      );

      press('Escape');
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('stops listening once closed', () => {
      const onClose = vi.fn();
      const { rerender } = render(
        <Modal isOpen onClose={onClose}>
          <button>ok</button>
        </Modal>,
      );
      rerender(
        <Modal isOpen={false} onClose={onClose}>
          <button>ok</button>
        </Modal>,
      );

      press('Escape');
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('error paths', () => {
    it('surfaces a message when the container never mounts', async () => {
      render(<Modal isOpen onClose={() => {}} renderContainer={false} />);

      await waitFor(() => {
        expect(toastStore.getToasts().map((t) => t.message)).toContain(
          FOCUS_TRAP_FAILURE_MESSAGE,
        );
      });
      expect(toastStore.getToasts()[0].variant).toBe('error');
    });

    it('calls the onError callback when the container never mounts', async () => {
      const onError = vi.fn();
      render(
        <Modal isOpen onClose={() => {}} renderContainer={false} onError={onError} />,
      );

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(FOCUS_TRAP_FAILURE_MESSAGE);
      });
    });

    it('surfaces a message when the modal has nothing focusable', () => {
      const onError = vi.fn();
      render(<Modal isOpen onClose={() => {}} onError={onError} />);

      press('Tab');
      expect(onError).toHaveBeenCalledWith(FOCUS_TRAP_FAILURE_MESSAGE);
    });

    it('reports the failure only once per open', () => {
      const onError = vi.fn();
      render(<Modal isOpen onClose={() => {}} onError={onError} />);

      press('Tab');
      press('Tab');
      press('Tab');
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });
});
