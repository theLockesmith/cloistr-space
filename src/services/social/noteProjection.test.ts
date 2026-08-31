/**
 * @fileoverview Tests for noteProjection helpers.
 *
 * tryParseEmbeddedNote validates stranger-authored JSON before any field
 * is used -- the test cases that matter most are the hostile ones.
 */

import { describe, it, expect } from 'vitest';
import { tryParseEmbeddedNote } from './noteProjection';

const BASE_EVENT = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  kind: 1,
  created_at: 1700000000,
  content: 'hello world',
  tags: [],
};

describe('tryParseEmbeddedNote', () => {
  it('returns a valid RawEvent for correct kind:1 JSON', () => {
    const result = tryParseEmbeddedNote(JSON.stringify(BASE_EVENT));
    expect(result).not.toBeNull();
    expect(result?.id).toBe(BASE_EVENT.id);
    expect(result?.pubkey).toBe(BASE_EVENT.pubkey);
    expect(result?.content).toBe('hello world');
    expect(result?.created_at).toBe(1700000000);
    expect(result?.tags).toEqual([]);
  });

  it('returns null for empty string (relay omitted content)', () => {
    expect(tryParseEmbeddedNote('')).toBeNull();
    expect(tryParseEmbeddedNote('   ')).toBeNull();
  });

  it('returns null for non-JSON string', () => {
    expect(tryParseEmbeddedNote('not json')).toBeNull();
  });

  it('returns null for a non-object JSON value', () => {
    expect(tryParseEmbeddedNote('"a string"')).toBeNull();
    expect(tryParseEmbeddedNote('42')).toBeNull();
    expect(tryParseEmbeddedNote('null')).toBeNull();
  });

  it('returns null when kind is not 1', () => {
    const e = { ...BASE_EVENT, kind: 6 };
    expect(tryParseEmbeddedNote(JSON.stringify(e))).toBeNull();
  });

  it('returns null when id is missing', () => {
    expect(tryParseEmbeddedNote(JSON.stringify({
      pubkey: BASE_EVENT.pubkey,
      kind: BASE_EVENT.kind,
      created_at: BASE_EVENT.created_at,
      content: BASE_EVENT.content,
      tags: BASE_EVENT.tags,
    }))).toBeNull();
  });

  it('returns null when id is empty string', () => {
    expect(tryParseEmbeddedNote(JSON.stringify({ ...BASE_EVENT, id: '' }))).toBeNull();
  });

  it('returns null when pubkey is missing', () => {
    expect(tryParseEmbeddedNote(JSON.stringify({
      id: BASE_EVENT.id,
      kind: BASE_EVENT.kind,
      created_at: BASE_EVENT.created_at,
      content: BASE_EVENT.content,
      tags: BASE_EVENT.tags,
    }))).toBeNull();
  });

  it('returns null when tags is not an array', () => {
    expect(tryParseEmbeddedNote(JSON.stringify({ ...BASE_EVENT, tags: null }))).toBeNull();
    expect(tryParseEmbeddedNote(JSON.stringify({ ...BASE_EVENT, tags: {} }))).toBeNull();
  });

  it('filters out non-string-array tags', () => {
    // A hostile relay sends a tag with a null inside; it must not pass.
    const e = { ...BASE_EVENT, tags: [['e', 'abc'], ['p', null], ['t', 'bitcoin']] };
    const result = tryParseEmbeddedNote(JSON.stringify(e));
    // The null-containing tag is dropped; clean ones survive.
    expect(result?.tags).toEqual([['e', 'abc'], ['t', 'bitcoin']]);
  });

  it('defaults created_at to 0 when missing or non-number', () => {
    const e = { ...BASE_EVENT, created_at: 'not-a-number' };
    const result = tryParseEmbeddedNote(JSON.stringify(e));
    expect(result?.created_at).toBe(0);
  });

  it('defaults content to empty string when missing', () => {
    const result = tryParseEmbeddedNote(JSON.stringify({
      id: BASE_EVENT.id,
      pubkey: BASE_EVENT.pubkey,
      kind: BASE_EVENT.kind,
      created_at: BASE_EVENT.created_at,
      tags: BASE_EVENT.tags,
    }));
    expect(result?.content).toBe('');
  });
});
