import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Override tsconfig's jsx:preserve so vitest can parse JSX inside vi.mock factories.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'happy-dom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
});
