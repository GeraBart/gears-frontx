import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Guards the theme seam: every CSS variable a component module consumes must
// be defined by theme.css (the single branding surface), except the vars the
// Base UI positioner provides at runtime.

const srcDir = dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(join(srcDir, 'styles', 'theme.css'), 'utf8');

const BASE_UI_RUNTIME_VARS = new Set([
  '--anchor-width',
  '--anchor-height',
  '--available-width',
  '--available-height',
  '--transform-origin',
  // Written by Base UI's Toast primitive (index/offset/height/swipe state
  // per toast, frontmost height on the viewport) — the Toast equivalent of
  // the positioner vars above.
  '--toast-index',
  '--toast-offset-y',
  '--toast-height',
  '--toast-swipe-movement-x',
  '--toast-swipe-movement-y',
  '--toast-frontmost-height',
]);

const definedTokens = new Set(
  Array.from(themeCss.matchAll(/(--[a-z0-9-]+)\s*:/g), (match) => match[1]),
);

const componentsDir = join(srcDir, 'components');
const moduleFiles = readdirSync(componentsDir, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.module.css'))
  .map((file) => join(componentsDir, file));

describe('theme tokens', () => {
  it('defines the radius scale derived from --radius', () => {
    for (const token of [
      '--radius',
      '--radius-xs',
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
      '--radius-xl',
    ]) {
      expect(definedTokens.has(token), `${token} is missing from theme.css`).toBe(true);
    }
  });

  // Policy: every `var(--x)` a component's CSS reads must be themeable
  // (theme.css), written by Base UI at runtime (BASE_UI_RUNTIME_VARS), or
  // locally declared and exempted below by one of two shapes:
  //   - SAME part, own private use — e.g. Toast's stacked-card transform
  //     math (local arithmetic, not a themeable/brandable value), read
  //     from another selector for that same class's states
  //     (`.toast[data-expanded]`, `.toast::after`, ...).
  //   - ANCESTOR part, read by a descendant via `.declarer .reader` — e.g.
  //     Card declares `--card-spacing`/`--card-title-*` on `.card` and
  //     reads them from `.card .cardHeader`, `.card .cardContent`,
  //     `.card .cardTitle`, etc. This is a genuine cross-part read (the
  //     value crosses from Card's root into its Header/Content/Footer/
  //     Title parts) — sanctioned because it's CSS custom-property
  //     inheritance itself doing the work, not a coincidence: prefixing
  //     the reader's selector with the declarer's class is what makes the
  //     value resolve to the *nearest* such ancestor at runtime, which is
  //     also what makes a nested Card size itself independently of an
  //     outer one (see card.module.css).
  // Both shapes are scoped by leading CSS class, not by file: a token
  // declared under `.card` may be read from any selector whose first class
  // is `.card` (`.card .cardHeader`, `.card.sizeSm`, `.card:has(...)`,
  // ...), but not from an unrelated class in the same file — a token must
  // never cross from one component part into another by accident just
  // because a test only checked "declared somewhere in this file".
  //
  // Known blind spot: `leadingClass` reads only the selector's first class
  // token, so it cannot distinguish a descendant combinator (`.card .x`,
  // where inheritance genuinely carries the declared value down) from a
  // sibling one (`.card ~ .x`, `.card + .x`, where it does not — `var()`
  // would resolve to nothing there). Both bucket identically today, so
  // the guard would wave a sibling-combinator reader through too. Nothing
  // in the kit currently reads a local token that way, so it's left
  // unfixed rather than guarded against speculatively — but it means this
  // exemption checks "is the reader prefixed by the declarer's class",
  // not "would inheritance actually deliver the value here", and the two
  // are not the same guarantee.
  //
  // Widening this further should widen the policy statement above, not
  // just the mechanism below.
  function leadingClass(selector: string) {
    return selector.match(/\.[a-z][a-z0-9-]*/i)?.[0];
  }

  // A lightweight rule splitter, not a real CSS parser: matches each
  // innermost `selector { declarations-without-nested-braces }` pair. An
  // @media/@keyframes wrapper's own `{` never closes before hitting the
  // nested rule's `{`, so `[^{}]*` fails to match it and the wrapper is
  // skipped on its own — only real declaration blocks come out of this.
  // Comments are stripped first: otherwise the "selector" capture (which
  // runs back to the previous `}`) swallows whatever comment precedes the
  // rule, and prose mentioning a dotted filename (`theme.css`,
  // `tokens.test.ts`) parses as a bogus leading class.
  function extractRules(css: string) {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    return Array.from(withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => ({
      selector: (match[1] ?? '').trim(),
      body: match[2] ?? '',
    }));
  }

  it.each(moduleFiles)('%s consumes only theme-defined or same-part local variables', (file) => {
    const css = readFileSync(file, 'utf8');
    const rules = extractRules(css);

    // Collect each class's own locally-declared custom properties first...
    const locallyDeclaredByClass = new Map<string, Set<string>>();
    for (const rule of rules) {
      const cls = leadingClass(rule.selector);
      if (!cls) {
        continue;
      }
      const declared = Array.from(
        rule.body.matchAll(/(--[a-z0-9-]+)\s*:/g),
        (match) => match[1] ?? '',
      );
      const set = locallyDeclaredByClass.get(cls) ?? new Set<string>();
      for (const name of declared) {
        set.add(name);
      }
      locallyDeclaredByClass.set(cls, set);
    }

    // ...then check every rule's usages, including rules with no leading
    // class (e.g. a bare @keyframes step) — those get no local exemption,
    // since there's no "part" to scope one to; they must be a real token.
    for (const rule of rules) {
      const cls = leadingClass(rule.selector);
      const used = Array.from(
        rule.body.matchAll(/var\((--[a-z0-9-]+)/g),
        (match) => match[1] ?? '',
      );
      for (const token of Array.from(new Set(used))) {
        if (BASE_UI_RUNTIME_VARS.has(token)) {
          continue;
        }
        if (cls && locallyDeclaredByClass.get(cls)?.has(token)) {
          continue;
        }
        expect(definedTokens.has(token), `${token} is not defined in theme.css`).toBe(true);
      }
    }
  });

  it('keeps raw colors out of component modules', () => {
    for (const file of moduleFiles) {
      const css = readFileSync(file, 'utf8');
      const raw = css.match(/#[0-9a-f]{3,8}\b|rgb\(|rgba\(|hsl\(|oklch\(/i);
      expect(raw, `raw color "${raw?.[0]}" in ${file}`).toBeNull();
    }
  });
});
