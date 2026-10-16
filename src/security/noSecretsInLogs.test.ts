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

/**
 * cloistr-pr's review of !221: shapes the second guard (hand-tokenised, kept
 * below as `secondGuard`) let through. The parser-based scanner catches each.
 */
/** Console methods that print their arguments. */
const LOG_CALL2 = /console\.(log|warn|error|info|debug|dir|trace|table)\(/g;

/** Names that hold key material. */
const SECRET_NAME2 = /\b\w*(secret|nsec|privkey|privatekey|seckey)\w*\b/gi;

/** `hasX: !!value` logs a boolean. Removed per occurrence, nothing else. */
const PRESENCE_FLAG2 = /\bhas\w*\s*:\s*!!\s*[\w.?]+/g;

/** Each console call with its argument text, up to the matching paren. */
function consoleCalls2(text: string): string[] {
  const calls: string[] = [];
  for (const m of text.matchAll(LOG_CALL2)) {
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      i++;
    }
    calls.push(text.slice(m.index, i));
  }
  return calls;
}

/**
 * Drop the TEXT of string literals (words in a message are not values) but
 * keep every `${...}` expression of a template literal, which is a value.
 */
function stripLiteralText2(code: string): string {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === "'" || c === '"') {
      const end = code.indexOf(c, i + 1);
      out += "''";
      i = end === -1 ? code.length : end + 1;
    } else if (c === '`') {
      i++;
      out += '`';
      while (i < code.length && code[i] !== '`') {
        if (code[i] === '$' && code[i + 1] === '{') {
          let depth = 1;
          let j = i + 2;
          while (j < code.length && depth > 0) {
            if (code[j] === '{') depth++;
            else if (code[j] === '}') depth--;
            j++;
          }
          out += ` ${code.slice(i + 2, j - 1)} `;
          i = j;
        } else {
          i++;
        }
      }
      out += '`';
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Secret-named values a console call passes. */
function secretsLogged2(call: string): string[] {
  const code = stripLiteralText2(call).replace(PRESENCE_FLAG2, '');
  return [...code.matchAll(SECRET_NAME2)].map((m) => m[0]).filter((name) => !/^has[A-Z]/.test(name));
}

/** Any slice, substring or substr of a secret-named value. */
function secretSlices2(text: string): string[] {
  return [
    ...text.matchAll(/\b\w*(secret|nsec|privkey|privatekey|seckey)\w*\??\.(slice|substring|substr)\(/gi),
  ].map((m) => m[0]);
}

/** Every offence in a source file. */
function secondGuard(text: string): string[] {
  return [...consoleCalls2(text).flatMap(secretsLogged2), ...secretSlices2(text)];
}

describe('bypasses of the second guard are caught', () => {
  it.each([
    ["a ')' inside a log string", "console.log('done :) retrying', clientSecretKey);"],
    ['an escaped quote in a log string', "console.log('don\\'t', clientSecretKey);"],
    ["console['log']", "console['log'](clientSecretKey);"],
    ['console.log?.()', 'console.log?.(clientSecretKey);'],
    ['console.assert', 'console.assert(ok, clientSecretKey);'],
    ['console.group', 'console.group(clientSecretKey);'],
    ['.slice after a newline', 'const p = clientSecretKey\n  .slice(0, 8);'],
    ['[...secret].slice', 'const p = [...clientSecretKey].slice(0, 8);'],
  ])('%s', (_label, source) => {
    expect(secondGuard(source)).toEqual([]);
    expect(scanSource(source).length).toBeGreaterThan(0);
  });

  it('still allows flags, message words and object keys', () => {
    expect(scanSource("console.log('Session:', { hasClientSecretKey: !!auth.clientSecretKey });")).toEqual([]);
    expect(scanSource("console.warn('No client secret key found (retrying)');")).toEqual([]);
    expect(scanSource('console.log(`secret ${count} items`);')).toEqual([]);
    expect(scanSource("console.log({ secretKeyPresent: !!k, label: 'nsec' });")).toEqual([]);
    expect(scanSource("const s = 'my secret'.slice(0, 2);")).toEqual([]);
  });
});
