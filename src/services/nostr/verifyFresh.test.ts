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
import ts from 'typescript';
import { ESLint } from 'eslint';
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

// Modules that export verifyEvent / verifiedSymbol.
const VERIFYING_MODULE = /^nostr-tools(\/(pure|wasm|core))?$/;
const BANNED = new Set(['verifyEvent', 'verifiedSymbol']);

/**
 * Every way a file can reach verifyEvent, found by parsing imports rather
 * than matching text, so `import { verifyEvent as checkSig }` is caught.
 */
function bannedImports(source: string, fileName = 'x.ts'): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const isVerifying = (n: ts.Node | undefined) => !!n && ts.isStringLiteral(n) && VERIFYING_MODULE.test(n.text);
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && isVerifying(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) found.push('namespace import');
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const imported = (el.propertyName ?? el.name).text;
          if (BANNED.has(imported)) found.push(imported);
        }
      }
    } else if (ts.isExportDeclaration(node) && isVerifying(node.moduleSpecifier)) {
      found.push('re-export');
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      isVerifying(node.arguments[0])
    ) {
      found.push('dynamic import');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('bannedImports finds every route to verifyEvent', () => {
  it.each([
    ["import { verifyEvent } from 'nostr-tools';", 'verifyEvent'],
    ["import { verifyEvent as checkSig } from 'nostr-tools';", 'verifyEvent'],
    ["import { finalizeEvent, verifyEvent as v } from 'nostr-tools/pure';", 'verifyEvent'],
    ["import { verifiedSymbol as s } from 'nostr-tools/core';", 'verifiedSymbol'],
    ["import * as nt from 'nostr-tools';", 'namespace import'],
    ["import nt, * as all from 'nostr-tools/wasm';", 'namespace import'],
    ["const { verifyEvent: c } = await import('nostr-tools');", 'dynamic import'],
    ["const nt = require('nostr-tools/pure');", 'dynamic import'],
    ["export { verifyEvent as ok } from 'nostr-tools';", 're-export'],
  ])('%s', (src, expected) => {
    expect(bannedImports(src)).toEqual([expected]);
  });

  it('leaves ordinary imports alone', () => {
    const src = [
      "import { finalizeEvent, nip19, type Event } from 'nostr-tools';",
      "import { bytesToHex } from 'nostr-tools/utils';",
      "const { bytesToHex: h } = await import('nostr-tools/utils');",
      "const verifyEvent = (e: unknown) => e; // a local name, not the import",
    ].join('\n');
    expect(bannedImports(src)).toEqual([]);
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
          for (const hit of bannedImports(readFileSync(path, 'utf8'), name)) offenders.push(`${relative(root, path)}: ${hit}`);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it('lint refuses the aliased import too', async () => {
    const eslint = new ESLint({ cwd: join(__dirname, '..', '..', '..') });
    const lint = async (code: string) => {
      const [result] = await eslint.lintText(code, { filePath: join(__dirname, 'planted.ts') });
      return result.messages.map((m) => m.ruleId);
    };
    expect(await lint("import { verifyEvent as checkSig } from 'nostr-tools';\nexport const f = checkSig;\n")).toContain('no-restricted-imports');
    expect(await lint("import * as nt from 'nostr-tools';\nexport const f = nt;\n")).toContain('no-restricted-syntax');
    expect(await lint("export const f = () => import('nostr-tools/pure');\n")).toContain('no-restricted-syntax');
    expect(await lint("import { finalizeEvent } from 'nostr-tools';\nexport const f = finalizeEvent;\n")).toEqual([]);
  });
});
