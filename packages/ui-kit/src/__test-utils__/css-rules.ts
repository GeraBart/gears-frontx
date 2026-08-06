/*
 * A lightweight rule splitter, not a real CSS parser — shared by every test
 * that reads selector/declaration pairs out of a stylesheet (tokens.test.ts's
 * token-scale and theme-sync guards, button.test.tsx's focus-ring contrast
 * guard). Matches each innermost `selector { declarations-without-nested-braces }`
 * pair. An @media/@keyframes wrapper's own `{` never closes before hitting
 * the nested rule's `{`, so `[^{}]*` fails to match it and the wrapper is
 * skipped on its own — only real declaration blocks come out of this.
 * Comments are stripped first: otherwise the "selector" capture (which runs
 * back to the previous `}`) swallows whatever comment precedes the rule, and
 * prose mentioning a dotted filename (`theme.css`, `tokens.test.ts`) parses
 * as a bogus leading class.
 */

export interface CssRule {
  selector: string;
  body: string;
}

export function extractRules(css: string): CssRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return Array.from(withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => ({
    selector: (match[1] ?? '').trim(),
    // The trailing `}` the outer match consumes is put back onto the end
    // of `body` (not just left out) so a declaration-scanning regex can
    // use `[;}]` as its terminator and still catch a rule's LAST
    // declaration when it has no trailing semicolon (`padding: 12px }` —
    // valid CSS, invisible to a `;`-only terminator; see
    // tokens.test.ts's metric-scale guard, the case this was fixed for).
    body: `${match[2] ?? ''}}`,
  }));
}

/*
 * Every declaration in a rule's body as a plain name->value map — custom
 * properties (`--foo: ...`) and ordinary properties (`color: ...`) alike,
 * since `[a-z-]` as the first character class matches both a letter and
 * the leading `-` of `--foo`. `[;}]` as the terminator, not `;` alone, for
 * the same last-declaration reason extractRules keeps the closing brace.
 * Last declaration of a given name wins (a plain object literal via
 * Array.from -> Map already does this), matching how the cascade would
 * resolve two declarations of the same property in one rule.
 */
export function declarationMap(body: string): Map<string, string> {
  return new Map(
    Array.from(body.matchAll(/([a-z-][a-z0-9-]*)\s*:\s*([^;}]+)[;}]/g), (match) => [
      match[1] ?? '',
      (match[2] ?? '').trim(),
    ]),
  );
}
