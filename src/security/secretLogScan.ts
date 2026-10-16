/**
 * @fileoverview Source scan behind noSecretsInLogs.test.ts: no log line may
 * carry any part of a secret, not even a prefix.
 *
 * Parsed with the TypeScript compiler, not tokenised by hand: the earlier
 * scanners were regexes and character loops, and every way of writing a call
 * they had not foreseen (a ')' or an escaped quote inside a message,
 * console['log'], console.log?.(), a .slice on the next line) walked past
 * them. The parser already knows what is a string, an escape, an optional
 * call and a computed member.
 *
 * Offences:
 *  - a console call (any member: log, assert, group, ...) with an argument
 *    that names a secret-bearing value, in any position, template literals
 *    included;
 *  - any slice, substring or substr whose receiver names one.
 *
 * Allowed: `!!value` (logs a boolean), a `has...` name (a flag), the words of
 * a string literal, and object keys (labels, not values).
 *
 * NOT caught: a secret renamed first (`const k = clientSecretKey;
 * console.log(k)`), or console itself aliased (`const log = console.log`).
 * No source scan can follow those, and this one does not claim to.
 */

import ts from 'typescript';

/** Names that hold key material. */
export const SECRET_NAME = /(secret|nsec|privkey|privatekey|seckey)/i;

const SLICE_METHODS = new Set(['slice', 'substring', 'substr']);

const isSecretName = (name: string) => SECRET_NAME.test(name) && !/^has[A-Z]/.test(name);

/** Strip wrappers that do not change what is called: parens, `!`, `as`. */
function unwrap(node: ts.Expression): ts.Expression {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n)) n = n.expression;
  return n;
}

/** `console`, `window.console` or `globalThis.console`. */
function isConsole(node: ts.Expression): boolean {
  const n = unwrap(node);
  if (ts.isIdentifier(n)) return n.text === 'console';
  return ts.isPropertyAccessExpression(n) && n.name.text === 'console' && ts.isIdentifier(unwrap(n.expression));
}

/** A call of any member of console, however the member is written. */
function isConsoleCall(call: ts.CallExpression): boolean {
  const callee = unwrap(call.expression);
  if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
    return isConsole(callee.expression);
  }
  return false;
}

/** `!!x`: a boolean, whatever x is. */
function isPresenceFlag(node: ts.Node): boolean {
  return (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isPrefixUnaryExpression(node.operand) &&
    node.operand.operator === ts.SyntaxKind.ExclamationToken
  );
}

/** Secret-named identifiers that are VALUES somewhere inside `node`. */
function secretNamesIn(node: ts.Node): string[] {
  const found: string[] = [];
  const visit = (n: ts.Node): void => {
    if (isPresenceFlag(n) || ts.isTypeNode(n)) return;
    if (ts.isStringLiteralLike(n) || ts.isNumericLiteral(n) || ts.isRegularExpressionLiteral(n)) return;
    if (ts.isPropertyAssignment(n)) {
      // The key is a label; only the value can carry a secret.
      visit(n.initializer);
      return;
    }
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) {
      if (isSecretName(n.text)) found.push(n.text);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function where(sf: ts.SourceFile, node: ts.Node): string {
  return `line ${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
}

/** Every offence in a source file, as "line N: what". */
export function scanSource(text: string, fileName = 'source.tsx'): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offences: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (isConsoleCall(node)) {
        for (const arg of node.arguments) {
          for (const name of secretNamesIn(arg)) offences.push(`${where(sf, arg)}: logs ${name}`);
        }
      }
      const callee = unwrap(node.expression);
      if (ts.isPropertyAccessExpression(callee) && SLICE_METHODS.has(callee.name.text)) {
        for (const name of secretNamesIn(callee.expression)) {
          offences.push(`${where(sf, callee.name)}: ${callee.name.text} of ${name}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return offences;
}
