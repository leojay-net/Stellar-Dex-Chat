import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import coverageThresholds from './coverage-thresholds.json';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    allowOnly: false,
    setupFiles: './vitest.setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    testTimeout: 15000,
    hookTimeout: 15000,
    fakeTimers: {
      // Avoid mocking queueMicrotask (Vitest 3+ default) — prevents memory growth in CI.
      toFake: [
        'Date',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
      ],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportOnFailure: true,
      // CI applies the global floor after merging all four shards.
      thresholds:
        process.env.VITEST_COVERAGE_SHARD === 'true'
          ? undefined
          : coverageThresholds,
      cleanOnRerun: true,
      exclude: [
        '**/*.{test,spec}.{ts,tsx}',
        '**/node_modules/**',
        '**/.next/**',
      ],
    },
  },
});
