/**
 * Vite config used by the tooling around the app, not by the app itself —
 * Next.js builds with its own bundler. Vitest and vite-node both read this
 * file, so the `@` path alias is declared once and works for tests and for the
 * scripts in `scripts/`.
 */

import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
