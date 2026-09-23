'use client';

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useMediaQuery } from '@/hooks/useMediaQuery';

interface ReceiptQrCodeProps {
  value: string;
  label?: string;
}

export default function ReceiptQrCode({ value, label }: ReceiptQrCodeProps) {
  const [dataUrl, setDataUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(true);
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(() => {
    let cancelled = false;
    setIsGenerating(true);

    QRCode.toDataURL(value, {
      width: 128,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
          setIsGenerating(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDataUrl('');
          setIsGenerating(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div className="receipt-qr-wrapper flex flex-col items-center gap-1 pt-2 border-t dark:border-gray-700">
      {isGenerating ? (
        <div
          role="status"
          aria-live="polite"
          className="receipt-qr-loading flex h-32 w-32 items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
        >
          {prefersReducedMotion ? 'Generating QR code…' : 'Generating QR code…'}
        </div>
      ) : dataUrl ? (
        // A generated data: URL gains nothing from next/image optimisation.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          alt={label ?? 'Transaction verification QR code'}
          className="receipt-qr-code h-32 w-32"
          width={128}
          height={128}
        />
      ) : null}
      <span className="receipt-qr-label text-[9px] text-gray-500 uppercase tracking-wide">
        Scan to verify
      </span>
    </div>
  );
}
