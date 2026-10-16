/**
 * No log line may carry any part of a secret, not even a prefix. AuthProvider
 * logged the first 16 hex characters of the NIP-46 client secret key on every
 * sign-in and restore until 2026-10-15.
 *
 * Source-level check: a console call whose arguments name a secret-bearing
 * value, or any slice of a secret-named value, fails the build. Presence
 * flags such as `hasClientSecretKey: !!x` are allowed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Each console.* call with its argument text (up to the matching paren). */
function consoleCalls(text: string): string[] {
  const calls: string[] = [];
  const start = /console\.(log|warn|error|info|debug)\(/g;
  let m: RegExpExecArray | null;
  while ((m = start.exec(text))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      i++;
    }
    calls.push(text.slice(m.index, i));
  }
  return calls;
}

const SECRET_NAME = /\b\w*(secret|nsec|privkey|privateKey|seckey)\w*\b/gi;
const PRESENCE_FLAG = /^has[A-Z]/;

describe('no secrets in logs', () => {
  const files = sourceFiles(SRC);

  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no console call passes a secret-named value', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const call of consoleCalls(readFileSync(file, 'utf8'))) {
        // Drop string literals: words inside a message are not values.
        const code = call.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");
        for (const [name] of code.matchAll(SECRET_NAME)) {
          // `hasClientSecretKey: !!auth.clientSecretKey` logs a boolean.
          const flagged = new RegExp(`\\b(has\\w*)\\s*:\\s*!!\\s*[\\w.?]*${name}`).test(code);
          if (!PRESENCE_FLAG.test(name) && !flagged) offenders.push(`${file}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('nothing slices a secret-named value', () => {
    const offenders = files.filter((f) => /[sS]ecret\w*\??\.slice\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
