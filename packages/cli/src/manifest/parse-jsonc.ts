// @cpt-algo:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2
/**
 * Tolerant reader for `tsconfig*.json` carriers.
 *
 * TypeScript's own config reader (`ts.parseConfigFileTextToJson`) accepts
 * JSONC, not strict JSON: line comments, block comments, and trailing
 * commas are all legal in a tsconfig and `tsc` builds it without complaint.
 * `tsc` also strips a leading UTF-8 byte-order mark before reading, so a
 * BOM-prefixed tsconfig it accepts unmodified is well-formed too.
 * `validate-content-self-containment.ts` used to read every carrier -
 * including tsconfig - with plain `JSON.parse`, so a tsconfig that `tsc`
 * accepts unmodified could still be reported as "not valid JSON": a false
 * positive that sends the developer to fix a file that isn't broken
 * (review finding on #498).
 *
 * `typescript` is a devDependency of this package, not a production one -
 * `packages/cli` ships with zero production dependencies by design - so
 * `ts.parseConfigFileTextToJson` is not reachable from the published CLI,
 * and no JSONC parser is a reachable production dependency either (checked
 * against this package's and the workspace root's `dependencies`). Adding
 * one is deliberately avoided given this repo's known npm-lockfile
 * fragility across npm versions, so this is a small in-repo reader instead
 * of a new dependency.
 *
 * Deliberately NOT a single combined state machine: comment-stripping and
 * trailing-comma-stripping are two separate strings-aware passes, each
 * simple enough to read in isolation. Combining them would need the
 * trailing-comma scan to look ahead through comment text it hasn't
 * stripped yet (`1, // note\n]` is a trailing comma once the comment is
 * gone); running comment-stripping first removes that interaction instead
 * of encoding it.
 *
 * @packageDocumentation
 */

const BACKSLASH = '\\';
const DOUBLE_QUOTE = '"';
const BYTE_ORDER_MARK = '\uFEFF';

/**
 * Strips line comments and block comments from `text`, leaving every other
 * character - including a comment-opener-looking substring that appears
 * inside a JSON string value, e.g. an `"extends": "https://..."`-shaped
 * string - untouched. A comment-matching regular expression applied to the
 * whole text cannot make that distinction; this is a single-pass,
 * strings-aware scanner for exactly that reason.
 */
function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      out += ch;
      // An escaped character is copied together with its escaping
      // backslash and never itself flips `inString` - this is what keeps
      // `\"` inside a string from being read as the closing quote.
      if (ch === BACKSLASH && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === DOUBLE_QUOTE) inString = false;
      i += 1;
      continue;
    }
    if (ch === DOUBLE_QUOTE) {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue; // the newline itself (if any) is copied on the next iteration, preserving line structure
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      // An unterminated block comment runs to EOF; `i` lands at or past
      // `text.length` either way, and the subsequent `JSON.parse` call
      // reports the resulting truncated text as a syntax error - the fail-
      // closed path this module must preserve.
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Drops a comma that precedes `}` or `]` once only whitespace separates
 * them - the trailing-comma tolerance `tsc`'s own reader applies. Must run
 * AFTER `stripJsonComments`: a comma followed by a comment then a closing
 * bracket is a trailing comma too, and this pass only looks past
 * whitespace, so it must not still be looking at comment text. Strings-
 * aware for the same reason as `stripJsonComments` - a comma at the end of
 * a string VALUE (`"a,"`) is copied as-is, never dropped.
 */
function stripTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === BACKSLASH && i + 1 < text.length) {
        out += text[i + 1];
        i += 1;
      } else if (ch === DOUBLE_QUOTE) {
        inString = false;
      }
      continue;
    }
    if (ch === DOUBLE_QUOTE) {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let lookahead = i + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead])) lookahead += 1;
      if (text[lookahead] === '}' || text[lookahead] === ']') continue; // trailing comma - drop it, keep scanning from the closing bracket
    }
    out += ch;
  }
  return out;
}

/**
 * Parses `text` as JSONC: plain JSON plus the comments, trailing commas, and
 * leading byte-order mark `tsc`'s own config reader tolerates. Genuinely
 * malformed input - anything still unparseable once those are accounted for -
 * still throws, so a caller that fails closed on a caught error keeps doing
 * so; this function only widens what counts as WELL-formed, never what
 * counts as malformed.
 *
 * @param text - Raw file content of a `tsconfig*.json` carrier.
 * @throws {SyntaxError} When `text` is not valid JSON even with comments and trailing commas stripped.
 */
export function parseJsonc(text: string): unknown {
  // A leading UTF-8 byte-order mark sits at index 0, inside no string and
  // consumed by no comment, so it survives both passes and then makes
  // `JSON.parse` throw on an otherwise valid file. `tsc`'s own config reader
  // strips it, so a BOM-prefixed tsconfig `tsc` accepts unmodified must not be
  // reported as broken JSON here. Only a single leading mark is dropped; a BOM
  // elsewhere is genuine malformed input and stays for `JSON.parse` to reject.
  const withoutBom = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
  return JSON.parse(stripTrailingCommas(stripJsonComments(withoutBom)));
}
