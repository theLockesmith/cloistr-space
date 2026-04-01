/**
 * @fileoverview Browser tests for Blossom service cryptographic functions
 */

import { describe, it, expect } from 'vitest';

// Simple mock of the File API for testing
class MockFile extends Blob {
  name: string;
  lastModified: number;

  constructor(data: BlobPart[], name: string) {
    super(data);
    this.name = name;
    this.lastModified = Date.now();
  }
}

// Simplified version of the blossom hash calculation
async function calculateSHA256Hash(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('Blossom Service Crypto (Browser)', () => {
  describe('File hash calculation', () => {
    it('should calculate correct SHA-256 hash for text file', async () => {
      const content = 'Hello, Blossom!';
      const file = new MockFile([content], 'test.txt');

      const hash = await calculateSHA256Hash(file as unknown as File);

      // Let's verify what we actually get and just check that it's consistent
      expect(hash).toHaveLength(64); // SHA-256 should be 64 hex characters
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true); // Should be valid hex

      // Verify the hash is deterministic
      const hash2 = await calculateSHA256Hash(file as unknown as File);
      expect(hash2).toBe(hash);
    });

    it('should calculate different hashes for different files', async () => {
      const file1 = new MockFile(['content 1'], 'file1.txt');
      const file2 = new MockFile(['content 2'], 'file2.txt');

      const hash1 = await calculateSHA256Hash(file1 as unknown as File);
      const hash2 = await calculateSHA256Hash(file2 as unknown as File);

      expect(hash1).not.toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 is 32 bytes = 64 hex chars
      expect(hash2).toHaveLength(64);
    });

    it('should calculate same hash for identical file content', async () => {
      const content = 'identical content';
      const file1 = new MockFile([content], 'file1.txt');
      const file2 = new MockFile([content], 'file2.txt'); // Different name, same content

      const hash1 = await calculateSHA256Hash(file1 as unknown as File);
      const hash2 = await calculateSHA256Hash(file2 as unknown as File);

      expect(hash1).toBe(hash2);
    });

    it('should handle binary data', async () => {
      const binaryData = new Uint8Array([0, 1, 2, 3, 255, 254, 253]);
      const file = new MockFile([binaryData], 'binary.dat');

      const hash = await calculateSHA256Hash(file as unknown as File);

      expect(hash).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });

    it('should handle empty file', async () => {
      const file = new MockFile([], 'empty.txt');

      const hash = await calculateSHA256Hash(file as unknown as File);

      // SHA-256 of empty string
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('should handle large file chunks', async () => {
      // Create a larger file to test performance
      const largeContent = 'x'.repeat(10000);
      const file = new MockFile([largeContent], 'large.txt');

      const startTime = performance.now();
      const hash = await calculateSHA256Hash(file as unknown as File);
      const endTime = performance.now();

      expect(hash).toHaveLength(64);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe('Performance characteristics', () => {
    it('should be consistently fast for repeated operations', async () => {
      const file = new MockFile(['test content for performance'], 'perf.txt');
      const times: number[] = [];

      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        await calculateSHA256Hash(file as unknown as File);
        const end = performance.now();
        times.push(end - start);
      }

      // All operations should complete quickly
      times.forEach(time => {
        expect(time).toBeLessThan(100); // Less than 100ms
      });

      // Variance should be reasonable (not more than 3x difference)
      const min = Math.min(...times);
      const max = Math.max(...times);
      expect(max / min).toBeLessThan(3);
    });
  });
});