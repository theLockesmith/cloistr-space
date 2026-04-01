/**
 * @fileoverview Test browser APIs that require real browser environment
 */

import { describe, it, expect } from 'vitest';

describe('Browser APIs', () => {
  it('should have access to Web Crypto API', () => {
    expect(crypto).toBeDefined();
    expect(crypto.randomUUID).toBeDefined();
    expect(crypto.subtle).toBeDefined();
  });

  it('should generate random UUID', () => {
    const uuid = crypto.randomUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('should compute SHA-256 hash with SubtleCrypto', async () => {
    const data = new TextEncoder().encode('hello world');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Expected SHA-256 of "hello world"
    expect(hashHex).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('should generate cryptographic random values', () => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);

    // Should not be all zeros (extremely unlikely with crypto random)
    expect(array.some(byte => byte !== 0)).toBe(true);
  });

  it('should have access to navigator API', () => {
    expect(navigator).toBeDefined();
    // Note: jsdom provides a basic navigator object, but not all APIs
  });
});