/**
 * @fileoverview Browser-specific tests for cryptographic functionality
 * These tests verify SubtleCrypto APIs work correctly in browser environment
 */

import { describe, it, expect } from 'vitest';

describe('Cryptographic Integration Tests (Browser)', () => {
  describe('SubtleCrypto key generation', () => {
    it('should generate ECDSA key pairs for signing', async () => {
      const keyPair = await crypto.subtle.generateKey(
        {
          name: 'ECDSA',
          namedCurve: 'P-256',
        },
        true,
        ['sign', 'verify']
      );

      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.publicKey.type).toBe('public');
      expect(keyPair.privateKey.type).toBe('private');
    });

    it('should generate AES keys for encryption', async () => {
      const key = await crypto.subtle.generateKey(
        {
          name: 'AES-GCM',
          length: 256,
        },
        true,
        ['encrypt', 'decrypt']
      );

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');
    });
  });

  describe('Digital signatures', () => {
    it('should sign and verify messages with ECDSA', async () => {
      const keyPair = await crypto.subtle.generateKey(
        {
          name: 'ECDSA',
          namedCurve: 'P-256',
        },
        false,
        ['sign', 'verify']
      );

      const message = new TextEncoder().encode('Hello, Nostr!');

      const signature = await crypto.subtle.sign(
        {
          name: 'ECDSA',
          hash: { name: 'SHA-256' },
        },
        keyPair.privateKey,
        message
      );

      expect(signature).toBeInstanceOf(ArrayBuffer);
      expect(signature.byteLength).toBeGreaterThan(0);

      const isValid = await crypto.subtle.verify(
        {
          name: 'ECDSA',
          hash: { name: 'SHA-256' },
        },
        keyPair.publicKey,
        signature,
        message
      );

      expect(isValid).toBe(true);
    });

    it('should reject invalid signatures', async () => {
      const keyPair = await crypto.subtle.generateKey(
        {
          name: 'ECDSA',
          namedCurve: 'P-256',
        },
        false,
        ['sign', 'verify']
      );

      const message = new TextEncoder().encode('Original message');
      const tamperedMessage = new TextEncoder().encode('Tampered message');

      const signature = await crypto.subtle.sign(
        {
          name: 'ECDSA',
          hash: { name: 'SHA-256' },
        },
        keyPair.privateKey,
        message
      );

      const isValid = await crypto.subtle.verify(
        {
          name: 'ECDSA',
          hash: { name: 'SHA-256' },
        },
        keyPair.publicKey,
        signature,
        tamperedMessage
      );

      expect(isValid).toBe(false);
    });
  });

  describe('Symmetric encryption', () => {
    it('should encrypt and decrypt with AES-GCM', async () => {
      const key = await crypto.subtle.generateKey(
        {
          name: 'AES-GCM',
          length: 256,
        },
        false,
        ['encrypt', 'decrypt']
      );

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plaintext = new TextEncoder().encode('Secret Nostr message');

      const encrypted = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv,
        },
        key,
        plaintext
      );

      expect(encrypted).toBeInstanceOf(ArrayBuffer);
      expect(encrypted.byteLength).toBeGreaterThan(plaintext.byteLength);

      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
        },
        key,
        encrypted
      );

      const decryptedText = new TextDecoder().decode(decrypted);
      expect(decryptedText).toBe('Secret Nostr message');
    });
  });

  describe('Key derivation', () => {
    it('should derive keys from passwords using PBKDF2', async () => {
      const password = new TextEncoder().encode('user-password');
      const salt = crypto.getRandomValues(new Uint8Array(16));

      const baseKey = await crypto.subtle.importKey(
        'raw',
        password,
        'PBKDF2',
        false,
        ['deriveKey']
      );

      const derivedKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: 100000,
          hash: 'SHA-256',
        },
        baseKey,
        {
          name: 'AES-GCM',
          length: 256,
        },
        false,
        ['encrypt', 'decrypt']
      );

      expect(derivedKey).toBeDefined();
      expect(derivedKey.type).toBe('secret');
    });
  });

  describe('Hash functions', () => {
    it('should compute consistent SHA-256 hashes', async () => {
      const data1 = new TextEncoder().encode('test data');
      const data2 = new TextEncoder().encode('test data');

      const hash1 = await crypto.subtle.digest('SHA-256', data1);
      const hash2 = await crypto.subtle.digest('SHA-256', data2);

      expect(hash1.byteLength).toBe(32);
      expect(hash2.byteLength).toBe(32);

      // Convert to hex for comparison
      const hex1 = Array.from(new Uint8Array(hash1))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      const hex2 = Array.from(new Uint8Array(hash2))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      expect(hex1).toBe(hex2);
    });

    it('should compute different hashes for different inputs', async () => {
      const data1 = new TextEncoder().encode('input 1');
      const data2 = new TextEncoder().encode('input 2');

      const hash1 = await crypto.subtle.digest('SHA-256', data1);
      const hash2 = await crypto.subtle.digest('SHA-256', data2);

      const hex1 = Array.from(new Uint8Array(hash1))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      const hex2 = Array.from(new Uint8Array(hash2))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      expect(hex1).not.toBe(hex2);
    });
  });

  describe('Random number generation', () => {
    it('should generate cryptographically random values', () => {
      const values1 = new Uint8Array(32);
      const values2 = new Uint8Array(32);

      crypto.getRandomValues(values1);
      crypto.getRandomValues(values2);

      // Should not be all zeros
      expect(values1.some(byte => byte !== 0)).toBe(true);
      expect(values2.some(byte => byte !== 0)).toBe(true);

      // Should be different
      expect(values1).not.toEqual(values2);
    });

    it('should generate valid UUIDs', () => {
      const uuid1 = crypto.randomUUID();
      const uuid2 = crypto.randomUUID();

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      expect(uuid1).toMatch(uuidRegex);
      expect(uuid2).toMatch(uuidRegex);
      expect(uuid1).not.toBe(uuid2);
    });
  });
});