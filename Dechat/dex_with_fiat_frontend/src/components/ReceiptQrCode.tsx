'use client';

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface ReceiptQrCodeProps {
  value: string;
  label?: string;
}

export default function ReceiptQrCode({ value, label }: ReceiptQrCodeProps) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    let cancelled = false;

    QRCode.toDataURL(value, {
      width: 128,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!dataUrl) return null;

  return (
    <div className="receipt-qr-wrapper flex flex-col items-center gap-1 pt-2 border-t dark:border-gray-700">
      <img
        src={dataUrl}
        alt={label ?? 'Transaction verification QR code'}
        className="receipt-qr-code w-32 h-32"
        width={128}
        height={128}
      />
      <span className="receipt-qr-label text-[9px] text-gray-500 uppercase tracking-wide">
        Scan to verify
      </span>
    </div>
  );
}
