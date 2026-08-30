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
    // Browser tests (real Web Crypto, navigator) and Playwright E2E only.
    //
    // nip0a.test.ts and ndk.test.ts used to be listed here too. Neither is a
    // browser test, both pass in jsdom in about 26ms, and nothing records why
    // they were excluded -- so 39 tests silently did not run, and every "tests
    // pass" claim in this repo was made without them. nip0a.test.ts covers the
    // NIP-0A CRDT, which is the code that published an empty contact list over
    // a real one; that suite existed the whole time and was never consulted.
    //
    // An excluded suite is indistinguishable from a passing one in any summary
    // line. If something here ever needs excluding again, say why in this
    // comment.
    exclude: [
      'node_modules/**',
      'tests/**',
      '**/*.browser.test.{ts,tsx}',
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