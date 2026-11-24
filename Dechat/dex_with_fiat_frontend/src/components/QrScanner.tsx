'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { X, Camera, CameraOff } from 'lucide-react';

/** Matches a bare Stellar strkey (G… 56 chars) or a SEP-7 `web+stellar:` URI. */
function extractStellarAddress(raw: string): string | null {
  const trimmed = raw.trim();
  // SEP-7 URI: web+stellar:pay?destination=G...&...
  const sep7Match = trimmed.match(/[?&]destination=([A-Z0-9]{56})(?:&|$)/);
  if (sep7Match) return sep7Match[1];
  // Plain strkey
  if (/^G[A-Z0-9]{55}$/.test(trimmed)) return trimmed;
  return null;
}

interface QrScannerProps {
  onScan: (address: string) => void;
  onClose: () => void;
}

export default function QrScanner({ onScan, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setScanning(true);
      }
    } catch (err) {
      const e = err as DOMException;
      if (e.name === 'NotAllowedError') {
        setError(
          'Camera permission denied. Please allow camera access and try again.',
        );
      } else {
        setError('Unable to access camera: ' + e.message);
      }
    }
  }, []);

  // Scan loop using BarcodeDetector when available, fallback to canvas+jsQR
  useEffect(() => {
    if (!scanning) return;

    let detector: {
      detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
    } | null = null;
    let jsQR:
      | ((
          data: Uint8ClampedArray,
          w: number,
          h: number,
        ) => { data: string } | null)
      | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let active = true;

    async function init() {
      // Prefer native BarcodeDetector
      if ('BarcodeDetector' in window) {
        try {
          // @ts-expect-error – BarcodeDetector not yet in TS lib
          const supported: string[] =
            await window.BarcodeDetector.getSupportedFormats();
          if (supported.includes('qr_code')) {
            // @ts-expect-error – BarcodeDetector is not yet in TypeScript's DOM library.
            detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          }
        } catch {
          // fall through to jsQR
        }
      }

      // JS fallback: dynamic import keeps bundle size low
      if (!detector) {
        try {
          jsQR = (await import('jsqr')).default;
          canvas = document.createElement('canvas');
          ctx = canvas.getContext('2d');
        } catch {
          setError('QR scanning is not supported in this browser.');
          return;
        }
      }

      tick();
    }

    async function tick() {
      if (!active || !videoRef.current || videoRef.current.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      try {
        let raw: string | null = null;

        if (detector) {
          const results = await detector.detect(videoRef.current);
          if (results.length > 0) raw = results[0].rawValue;
        } else if (jsQR && canvas && ctx) {
          const v = videoRef.current;
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(imgData.data, canvas.width, canvas.height);
          if (result) raw = result.data;
        }

        if (raw) {
          const addr = extractStellarAddress(raw);
          if (addr) {
            active = false;
            stopCamera();
            onScan(addr);
            return;
          }
        }
      } catch {
        // detector errors are transient; keep scanning
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    init();
    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [scanning, onScan, stopCamera]);

  useEffect(() => {
    startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="relative bg-black rounded-2xl overflow-hidden w-80 max-w-[90vw]">
        <button
          onClick={() => {
            stopCamera();
            onClose();
          }}
          aria-label="Close QR scanner"
          className="absolute top-3 right-3 z-10 text-white/80 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        {error ? (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <CameraOff className="w-10 h-10 text-red-400" />
            <p className="text-sm text-white/80">{error}</p>
            <button
              onClick={startCamera}
              className="mt-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-500"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              muted
              playsInline
              className="w-full aspect-square object-cover"
              aria-label="Camera viewfinder"
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {/* Viewfinder overlay */}
              <div className="w-48 h-48 border-2 border-white/60 rounded-lg" />
            </div>
            <div className="flex items-center justify-center gap-2 py-3 text-white/70 text-xs">
              <Camera className="w-4 h-4" />
              <span>Point at a Stellar address QR code</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
