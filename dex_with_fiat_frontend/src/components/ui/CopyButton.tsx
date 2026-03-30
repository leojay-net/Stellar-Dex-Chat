'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  value: string;
  className?: string;
  iconClassName?: string;
  successDurationMs?: number;
  tooltipPosition?: 'top' | 'bottom';
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (!value) {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back to execCommand for Safari/iOS compatibility.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';

    document.body.appendChild(textarea);

    const selection = document.getSelection();
    const selectedRange =
      selection && selection.rangeCount > 0
        ? selection.getRangeAt(0)
        : null;

    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const copied = document.execCommand('copy');

    document.body.removeChild(textarea);

    if (selectedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(selectedRange);
    }

    return copied;
  } catch {
    return false;
  }
}

export default function CopyButton({
  value,
  className = '',
  iconClassName = 'w-4 h-4',
  successDurationMs = 2000,
  tooltipPosition = 'top',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    const didCopy = await copyTextToClipboard(value);
    if (!didCopy) {
      return;
    }

    setCopied(true);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setCopied(false);
    }, successDurationMs);
  };

  const tooltipBaseClass =
    'pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[10px] font-medium text-white shadow-md transition-all';
  const tooltipPositionClass =
    tooltipPosition === 'bottom'
      ? 'top-full mt-1.5'
      : 'bottom-full mb-1.5';

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy to clipboard"
      title="Copy to clipboard"
      className={`relative inline-flex items-center justify-center rounded p-1 text-gray-400 transition-colors hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-transparent ${className}`}
    >
      <span
        className={`${tooltipBaseClass} ${tooltipPositionClass} ${copied ? 'translate-y-0 opacity-100' : 'translate-y-0.5 opacity-0'}`}
        role="status"
        aria-live="polite"
      >
        Copied!
      </span>
      {copied ? (
        <Check className={`${iconClassName} text-green-400`} />
      ) : (
        <Copy className={iconClassName} />
      )}
    </button>
  );
}