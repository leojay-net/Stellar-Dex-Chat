'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAccessibleModal } from '@/hooks/useAccessibleModal';

export interface ConfirmDestructiveActionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  /**
   * Short, specific name of the action, e.g. "Clear Audit Logs". Shown as
   * the dialog title and, when `requireTypedConfirmation` is set, as the
   * exact phrase the user must type to enable the confirm button.
   */
  actionName: string;
  /** What this action does, in plain language. */
  description: string;
  /** Concrete, irreversible consequences of this action, one per item. */
  consequences: string[];
  /**
   * For irreversible operations: the confirm button stays disabled until
   * the user types `actionName` exactly. Omit for lower-risk, reversible
   * actions that only need a single confirm click.
   */
  requireTypedConfirmation?: boolean;
  confirmLabel?: string;
  /** True while `onConfirm`'s returned promise is pending. */
  isConfirming?: boolean;
}

export default function ConfirmDestructiveActionDialog({
  isOpen,
  onClose,
  onConfirm,
  actionName,
  description,
  consequences,
  requireTypedConfirmation = false,
  confirmLabel = 'Confirm',
  isConfirming = false,
}: ConfirmDestructiveActionDialogProps) {
  const [typedValue, setTypedValue] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  const handleClose = () => {
    if (isConfirming) return;
    onClose();
  };

  useAccessibleModal(isOpen, modalRef, handleClose);

  // Reset any typed confirmation text whenever the dialog opens (or the
  // target action changes), so a previous action's typed text can never
  // leak through and silently satisfy a different action's confirmation.
  useEffect(() => {
    if (isOpen) {
      setTypedValue('');
    }
  }, [isOpen, actionName]);

  if (!isOpen) {
    return null;
  }

  const canConfirm = requireTypedConfirmation
    ? typedValue === actionName
    : true;

  const handleConfirmClick = () => {
    if (!canConfirm || isConfirming) {
      return;
    }
    onConfirm();
  };

  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const inputId = `${baseId}-confirm-input`;
  const hintId = `${baseId}-confirm-hint`;

  return (
    <motion.div
      className="theme-overlay fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        ref={modalRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="theme-surface theme-border relative w-full max-w-md border rounded-2xl shadow-2xl p-6"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
      >
        <div className="flex items-start justify-between mb-4 gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle
              className="w-5 h-5 flex-shrink-0"
              style={{ color: 'var(--color-danger)' }}
              aria-hidden="true"
            />
            <h2
              id={titleId}
              className="theme-text-primary text-lg font-semibold"
            >
              {actionName}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isConfirming}
            aria-label="Cancel and close"
            className="theme-text-muted hover:theme-text-primary transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div id={descriptionId} className="space-y-3 mb-5">
          <p className="theme-text-secondary text-sm">{description}</p>

          {consequences.length > 0 && (
            <div
              className="rounded-lg p-3 text-sm"
              style={{
                backgroundColor: 'var(--color-danger-soft)',
                color: 'var(--color-danger)',
              }}
              role="list"
              aria-label="Consequences of this action"
            >
              <p className="font-semibold mb-1">
                This action cannot be undone:
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                {consequences.map((item, index) => (
                  <li key={index} role="listitem">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {requireTypedConfirmation && (
          <div className="mb-5">
            <label
              htmlFor={inputId}
              className="block text-sm theme-text-secondary mb-1.5"
            >
              Type{' '}
              <span className="font-mono font-semibold theme-text-primary">
                {actionName}
              </span>{' '}
              to confirm
            </label>
            <input
              id={inputId}
              type="text"
              value={typedValue}
              onChange={(event) => setTypedValue(event.target.value)}
              autoComplete="off"
              autoFocus
              disabled={isConfirming}
              className="w-full px-3 py-2 rounded-md text-sm theme-input theme-border border"
              aria-describedby={hintId}
            />
            <p id={hintId} className="sr-only">
              Type the action name exactly to enable the confirm button.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isConfirming}
            className="px-4 py-2 rounded-md text-sm theme-border border theme-text-primary hover:opacity-80 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmClick}
            disabled={!canConfirm || isConfirming}
            className="px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--color-danger)' }}
          >
            {isConfirming ? 'Processing…' : confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
