/**
 * No log line may carry any part of a secret, not even a prefix. AuthProvider
 * logged the first 16 hex characters of the NIP-46 client secret key on every
 * sign-in and restore until 2026-10-15.
 *
 * Source-level check: a console call whose arguments name a secret-bearing
 * value (including inside a template literal), or any slice, substring or
 * substr of one, fails the build. A presence flag such as
 * `hasClientSecretKey: !!x` is allowed, and covers only that one value.
 * A secret renamed before logging is NOT caught; see secretLogScan.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scanSource } from './secretLogScan';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('no secrets in logs', () => {
  const files = sourceFiles(SRC);

  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no console call passes a secret-named value, and nothing slices one', () => {
    const offenders = files.flatMap((file) => scanSource(readFileSync(file, 'utf8')).map((o) => `${file}: ${o}`));
    expect(offenders).toEqual([]);
  });
});

/**
 * cloistr-pr's review of !212: shapes the first version of this guard let
 * through. Each is caught now; `firstGuard` is that version, kept so each
 * test also shows the bypass was real.
 */
function firstGuard(source: string): string[] {
  const out: string[] = [];
  const start = /console\.(log|warn|error|info|debug)\(/g;
  let m: RegExpExecArray | null;
  while ((m = start.exec(source))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
      i++;
    }
    const code = source.slice(m.index, i).replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");
    for (const [name] of code.matchAll(/\b\w*(secret|nsec|privkey|privateKey|seckey)\w*\b/gi)) {
      const flagged = new RegExp(`\\b(has\\w*)\\s*:\\s*!!\\s*[\\w.?]*${name}`).test(code);
      if (!/^has[A-Z]/.test(name) && !flagged) out.push(name);
    }
  }
  if (/[sS]ecret\w*\??\.slice\(/.test(source)) out.push('slice');
  return out;
}

describe('bypasses of the first guard are caught', () => {
  it.each([
    ['a secret inside a template literal', 'console.log(`key ${clientSecretKey}`);'],
    ['console.dir', 'console.dir(clientSecretKey);'],
    ['console.trace', 'console.trace(clientSecretKey);'],
    ['console.table', 'console.table({ clientSecretKey });'],
    ['a presence flag beside the raw value', 'console.log({ hasIt: !!clientSecretKey, clientSecretKey });'],
    ['nsec.slice', 'const shown = nsec.slice(0, 8);'],
    ['substring of a secret', 'const p = threadSecretHex.substring(0, 16);'],
  ])('%s', (_label, source) => {
    expect(firstGuard(source)).toEqual([]);
    expect(scanSource(source).length).toBeGreaterThan(0);
  });

  it('still allows a presence flag on its own, and words inside a message', () => {
    expect(scanSource("console.log('[Auth] Session data:', { hasClientSecretKey: !!auth.clientSecretKey });")).toEqual([]);
    expect(scanSource("console.warn('No client secret key found');")).toEqual([]);
  });
});
