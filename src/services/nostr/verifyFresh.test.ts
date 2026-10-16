/**
 * @fileoverview nostr-tools' verifyEvent caches its verdict on the event
 * object under a symbol, and an object spread copies symbol-keyed properties.
 * So `{ ...verified, content: forged }` passes verifyEvent without its id or
 * signature being checked again. verifyFresh rebuilds the event from its
 * fields first, so nothing cached travels with it.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { finalizeEvent, generateSecretKey, verifyEvent } from 'nostr-tools';
import { verifyFresh } from './verifyFresh';

const signed = () => finalizeEvent({ kind: 1, created_at: 1, tags: [['t', 'x']], content: 'real' }, generateSecretKey());

describe('verifyFresh', () => {
  it('accepts a genuine event', () => {
    expect(verifyFresh(signed())).toBe(true);
  });

  it('the hazard: a spread copy with forged content passes verifyEvent', () => {
    // If this ever fails, nostr-tools fixed it; verifyFresh stays correct.
    const ev = signed();
    expect(verifyEvent({ ...ev, content: 'forged' })).toBe(true);
  });

  it('refuses a spread copy with forged content', () => {
    const ev = signed();
    verifyEvent(ev);
    expect(verifyFresh({ ...ev, content: 'forged' })).toBe(false);
  });

  it('refuses a spread copy with a forged signature', () => {
    const ev = signed();
    verifyEvent(ev);
    expect(verifyFresh({ ...ev, sig: 'f'.repeat(128) })).toBe(false);
  });

  it('refuses a spread copy with a forged tag list', () => {
    const ev = signed();
    verifyEvent(ev);
    expect(verifyFresh({ ...ev, tags: [['t', 'y']] })).toBe(false);
  });
});

describe('no direct verifyEvent in src', () => {
  // A check that depends on somebody remembering is not a check.
  it('every signature check goes through verifyFresh', () => {
    const root = join(__dirname, '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !path.endsWith('verifyFresh.ts')) {
          if (/\bverifyEvent\s*\(|\bverifiedSymbol\b/.test(readFileSync(path, 'utf8'))) offenders.push(relative(root, path));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
