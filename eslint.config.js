import js from '@eslint/js';
import globals from 'globals';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
        React: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-unused-vars': 'off',
      'no-undef': 'off', // TypeScript handles this better
    },
  },
  {
    // nostr-tools' verifyEvent caches its verdict on the event object, and an
    // object spread carries the cache to a forged copy. Every signature check
    // goes through verifyFresh, which rebuilds the event first. Banning the
    // import (not the call) means an alias cannot get past it.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/services/nostr/verifyFresh.ts', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^nostr-tools(/(pure|wasm|core))?$',
              importNames: ['verifyEvent', 'verifiedSymbol'],
              message: 'Use verifyFresh (src/services/nostr/verifyFresh.ts): verifyEvent trusts a verdict cached on the object.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[source.value=/^nostr-tools(\\/(pure|wasm|core))?$/] > ImportNamespaceSpecifier",
          message: 'Import named functions from nostr-tools; a namespace import reaches verifyEvent unchecked.',
        },
        {
          selector: "ImportExpression[source.value=/^nostr-tools(\\/(pure|wasm|core))?$/]",
          message: 'Import named functions from nostr-tools statically; a dynamic import reaches verifyEvent unchecked.',
        },
      ],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
];
