'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { useAccessibleModal } from '@/hooks/useAccessibleModal';
import { isEditableShortcutTarget } from '@/lib/keyboardShortcuts';

const shortcutGroups = {
  Chat: [
    ['Ctrl / ⌘ + K', 'Open chat search and the command palette'],
    ['Ctrl / ⌘ + Enter', 'Send the message from the composer'],
    ['Ctrl / ⌘ + N', 'Start a new chat'],
    ['Ctrl / ⌘ + H', 'Open chat history'],
    ['Ctrl / ⌘ + Shift + C', 'Cancel an in-flight request'],
    ['Home / End', 'Jump to the start or end of the focused message list'],
    ['Page Up / Page Down', 'Scroll the focused message list'],
    ['R', 'Retry a focused message that failed to send'],
    ['C', 'Copy the transaction hash from a focused message'],
  ],
  Beneficiaries: [
    ['Tab / Shift + Tab', 'Move between saved beneficiary controls'],
    ['Enter / Space', 'Activate the focused beneficiary button'],
  ],
  Modals: [
    ['?', 'Open keyboard shortcut help outside text fields'],
    ['Escape', 'Close the active dialog'],
    ['Tab / Shift + Tab', 'Move forward or backward between dialog controls'],
    ['Ctrl / ⌘ + B', 'Open the bridge dialog from chat'],
  ],
  'Other views': [
    ['G', 'Open chat from the landing page'],
    ['D', 'Toggle the theme from the landing page'],
    ['R', 'Refresh the focused market price ticker or retry an error screen'],
    [
      'M',
      'Mark all notifications as read while the notification panel is open',
    ],
    ['D', 'Clear notifications while the notification panel is open'],
  ],
} as const;

export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { singleKeyShortcutsEnabled, setSingleKeyShortcutsEnabled } =
    useUserPreferences();
  const enabled = singleKeyShortcutsEnabled !== false;
  const close = () => setOpen(false);

  useAccessibleModal(open, dialogRef, close);

  useEffect(() => {
    if (!enabled || open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== '?' ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isEditableShortcutTarget(event.target) ||
        document.querySelector('[aria-modal="true"], dialog[open]')
      ) {
        return;
      }
      event.preventDefault();
      setOpen(true);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, open]);

  return (
    <>
      <button
        type="button"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts"
        aria-haspopup="dialog"
        aria-keyshortcuts={enabled ? '?' : undefined}
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-lg p-2 theme-text-secondary hover:bg-[var(--color-surface-elevated)] focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Keyboard aria-hidden="true" className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Tab') return;
              event.stopPropagation();
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
              }
            }}
            className="theme-surface theme-text-primary theme-border max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border p-5 shadow-xl"
          >
            <div className="flex items-center justify-between gap-4">
              <h2 id={titleId} className="text-lg font-semibold">
                Keyboard shortcuts
              </h2>
              <button
                type="button"
                onClick={close}
                className="rounded-md px-2 py-1 text-sm underline focus-visible:outline-2"
              >
                Close
              </button>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) =>
                  setSingleKeyShortcutsEnabled(event.currentTarget.checked)
                }
              />
              Enable single-key shortcuts
            </label>
            {Object.entries(shortcutGroups).map(([context, shortcuts]) => (
              <section key={context} className="mt-4">
                <h3 className="font-semibold">{context}</h3>
                <dl className="mt-2 space-y-2 text-sm">
                  {shortcuts.map(([key, action]) => (
                    <div
                      key={action}
                      className="grid grid-cols-[8rem_1fr] gap-3"
                    >
                      <dt>
                        <kbd className="theme-surface-muted rounded px-1 py-0.5">
                          {key}
                        </kbd>
                      </dt>
                      <dd>{action}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
