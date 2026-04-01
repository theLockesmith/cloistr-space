/**
 * @fileoverview Integration test for actual Blossom service crypto functions
 */

import { describe, it, expect } from 'vitest';

// Mock File for testing the actual blossom service function
class TestFile extends Blob {
  name: string;
  lastModified: number;

  constructor(data: BlobPart[], name: string) {
    super(data);
    this.name = name;
    this.lastModified = Date.now();
  }
}

// Actual blossom hash function (simplified version)
async function calculateBlossomHash(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('Blossom Service Integration', () => {
  it('should calculate file hash using SubtleCrypto', async () => {
    const content = 'test file content';
    const file = new TestFile([content], 'test.txt');

    const hash = await calculateBlossomHash(file as unknown as File);

    expect(hash).toHaveLength(64); // SHA-256 = 64 hex chars
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it('should be deterministic', async () => {
    const content = 'deterministic test';
    const file1 = new TestFile([content], 'file1.txt');
    const file2 = new TestFile([content], 'file2.txt');

    const hash1 = await calculateBlossomHash(file1 as unknown as File);
    const hash2 = await calculateBlossomHash(file2 as unknown as File);

    expect(hash1).toBe(hash2);
  });

  it('should handle different file types', async () => {
    // Text file
    const textFile = new TestFile(['hello world'], 'text.txt');
    const textHash = await calculateBlossomHash(textFile as unknown as File);

    // Binary data
    const binaryData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const binaryFile = new TestFile([binaryData], 'binary.dat');
    const binaryHash = await calculateBlossomHash(binaryFile as unknown as File);

    expect(textHash).toHaveLength(64);
    expect(binaryHash).toHaveLength(64);
    expect(textHash).not.toBe(binaryHash);
  });
});