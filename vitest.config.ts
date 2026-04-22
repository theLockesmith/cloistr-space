/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@services': path.resolve(__dirname, './src/services'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@types': path.resolve(__dirname, './src/types'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // CI-friendly settings
    pool: 'forks', // More reliable than threads on Alpine/CI
    testTimeout: 30000, // 30s per test
    hookTimeout: 30000,
    reporters: process.env.CI ? ['verbose'] : ['default'],
    // Exclude browser tests that require Playwright and E2E tests
    exclude: [
      'node_modules/**',
      'tests/**',
      '**/*.browser.test.{ts,tsx}',
      'src/services/crdt/nip0a.test.ts',
      'src/services/nostr/ndk.test.ts',
      'src/test/browser-apis.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.test.tsx',
        '**/*.test.ts',
      ],
    },
  },
});