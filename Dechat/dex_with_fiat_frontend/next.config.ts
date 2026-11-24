import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

// Origins the browser bundle calls directly. `connect-src` must list every one
// of them or the CSP blocks the request in production.
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const connectSrc = Array.from(
  new Set(
    [
      "'self'",
      'https://*.sentry.io',
      // Stellar network endpoints (defaults plus any configured override).
      'https://horizon.stellar.org',
      'https://horizon-testnet.stellar.org',
      'https://soroban-testnet.stellar.org',
      originOf(process.env.NEXT_PUBLIC_STELLAR_RPC_URL),
      originOf(process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL),
      'wss://*.freighter.app',
    ].filter((v): v is string => Boolean(v)),
  ),
);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-origin',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.sentry.io",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data:",
              `connect-src ${connectSrc.join(' ')}`,
              "frame-src 'self' https://*.freighter.app",
              "worker-src 'self' blob:",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  // `disableLogger` is deprecated in @sentry/nextjs v10; use the
  // webpack.treeshake option instead (#1490).
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
