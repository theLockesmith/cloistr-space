/**
 * @fileoverview Source scan behind noSecretsInLogs.test.ts: no log line may
 * carry any part of a secret, not even a prefix.
 *
 * It catches a secret-named value passed to a console call, however the call
 * is written, and any slice of a secret-named value. It does NOT catch a
 * secret renamed first (`const k = clientSecretKey; console.log(k)`): no
 * source scan can, and this one does not claim to.
 */

/** Console methods that print their arguments. */
const LOG_CALL = /console\.(log|warn|error|info|debug|dir|trace|table)\(/g;

/** Names that hold key material. */
export const SECRET_NAME = /\b\w*(secret|nsec|privkey|privatekey|seckey)\w*\b/gi;

/** `hasX: !!value` logs a boolean. Removed per occurrence, nothing else. */
const PRESENCE_FLAG = /\bhas\w*\s*:\s*!!\s*[\w.?]+/g;

/** Each console call with its argument text, up to the matching paren. */
export function consoleCalls(text: string): string[] {
  const calls: string[] = [];
  for (const m of text.matchAll(LOG_CALL)) {
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
export function stripLiteralText(code: string): string {
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
export function secretsLogged(call: string): string[] {
  const code = stripLiteralText(call).replace(PRESENCE_FLAG, '');
  return [...code.matchAll(SECRET_NAME)].map((m) => m[0]).filter((name) => !/^has[A-Z]/.test(name));
}

/** Any slice, substring or substr of a secret-named value. */
export function secretSlices(text: string): string[] {
  return [
    ...text.matchAll(/\b\w*(secret|nsec|privkey|privatekey|seckey)\w*\??\.(slice|substring|substr)\(/gi),
  ].map((m) => m[0]);
}

/** Every offence in a source file. */
export function scanSource(text: string): string[] {
  return [...consoleCalls(text).flatMap(secretsLogged), ...secretSlices(text)];
}
