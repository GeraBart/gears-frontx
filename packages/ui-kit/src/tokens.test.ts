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

// Strip comments before scanning for declarations: theme.css's prose quotes
// tokens with their values (`--radius: 0.625rem` etc.), and a token that
// only survives inside a comment must read as *removed*, not defined.
const definedTokens = new Set(
  Array.from(
    themeCss.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/(--[a-z0-9-]+)\s*:/g),
    (match) => match[1],
  ),
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
    // Function notations plus the named colors someone might actually
    // reach for. `white`/`black` need the lookarounds: `white-space` and
    // custom-property names like `--color-black` must not trip this.
    const rawColor =
      /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(|hwb\(|\blab\(|\blch\(|\bcolor\(|(?<![-\w])(?:white|black)(?![-\w])/i;
    for (const file of moduleFiles) {
      const css = readFileSync(file, 'utf8');
      const raw = css.match(rawColor);
      expect(raw, `raw color "${raw?.[0]}" in ${file}`).toBeNull();
    }
  });

  // Guards the token blocks in theme.css against drift: the dark palette is
  // hand-duplicated between [data-theme='dark'] and the prefers-color-scheme
  // media block (custom properties can't be shared across two selectors any
  // other way), and nothing but this test notices if the two copies diverge,
  // a new light token is added without a dark counterpart, or a
  // theme-invariant token (shape/scrim, not color) drifts into a theme block.
  describe('theme.css token blocks stay in sync', () => {
    const themeRules = extractRules(themeCss);

    // Every declaration, not just custom properties: the theme blocks also
    // carry `color-scheme`, and it needs the same drift guarantees — the two
    // dark blocks must both say `dark` (identity test), and a light-block
    // declaration must have dark counterparts (parity test). Custom-property
    // names start with `--`, ordinary properties with a letter; both match.
    function tokenMap(body: string) {
      return new Map(
        Array.from(body.matchAll(/([a-z-][a-z0-9-]*)\s*:\s*([^;]+);/g), (match) => [
          match[1] ?? '',
          (match[2] ?? '').trim(),
        ]),
      );
    }

    // Identify each block by selector shape rather than array position, so
    // reordering theme.css doesn't silently break this test. `invariantsBlock`
    // must match `:root` exactly — `lightBlock`'s selector also contains the
    // substring `:root` (it's `:root, [data-theme='light']`), so an exact
    // match is what keeps the two finders pointing at different blocks.
    const invariantsBlock = themeRules.find((rule) => rule.selector === ':root');
    const lightBlock = themeRules.find(
      (rule) =>
        rule.selector.includes(':root') &&
        rule.selector.includes("[data-theme='light']") &&
        !rule.selector.includes(':not('),
    );
    const darkAttrBlock = themeRules.find((rule) => rule.selector === "[data-theme='dark']");
    const darkMediaBlock = themeRules.find((rule) => rule.selector.includes(':root:not('));

    if (!invariantsBlock || !lightBlock || !darkAttrBlock || !darkMediaBlock) {
      throw new Error(
        "theme.css's token block selectors changed shape — update this test's block finders",
      );
    }

    const invariantTokensDeclared = tokenMap(invariantsBlock.body);
    const lightTokens = tokenMap(lightBlock.body);
    const darkAttrTokens = tokenMap(darkAttrBlock.body);
    const darkMediaTokens = tokenMap(darkMediaBlock.body);

    // Shape/scrim, not color: declared once on the invariants block and
    // deliberately never redefined in any theme block, because a theme scope
    // overrides colors, never shape or scrim (see the comment on theme.css's
    // `:root` invariants block).
    const THEME_INVARIANT_TOKENS = new Set([
      // Scrim behind modal-style popups. A dark tint dims the page in both
      // light and dark UI; --foreground would flip to near-white in dark
      // mode and brighten instead of dim (see the --overlay comment in
      // theme.css).
      '--overlay',
      // Radius scale derived from --radius. Corner shape isn't a light/dark
      // concern — consumers rebrand it by overriding --radius alone, in
      // either theme.
      '--radius',
      '--radius-xs',
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
      '--radius-xl',
    ]);

    it('defines the two dark blocks identically', () => {
      expect(Object.fromEntries(darkAttrTokens)).toEqual(Object.fromEntries(darkMediaTokens));
    });

    it('declares every theme-invariant token on the invariants block', () => {
      for (const token of Array.from(THEME_INVARIANT_TOKENS)) {
        expect(
          invariantTokensDeclared.has(token),
          `${token} is missing from theme.css's :root invariants block`,
        ).toBe(true);
      }
    });

    // A consequence of splitting shape/scrim onto their own :root-only block:
    // the light block now holds color tokens exclusively, so parity with the
    // dark blocks needs no exemption list — every light token must appear in
    // both. Don't reintroduce an exemption here; add a new entry to
    // THEME_INVARIANT_TOKENS (and to theme.css's invariants block) instead.
    it('redefines every light token in both dark blocks', () => {
      for (const token of Array.from(lightTokens.keys())) {
        expect(darkAttrTokens.has(token), `${token} missing from [data-theme='dark']`).toBe(true);
        expect(
          darkMediaTokens.has(token),
          `${token} missing from the prefers-color-scheme block`,
        ).toBe(true);
      }
    });

    it('never redefines the theme-invariant tokens in any theme block', () => {
      for (const token of Array.from(THEME_INVARIANT_TOKENS)) {
        expect(
          lightTokens.has(token),
          `${token} is theme-invariant but redefined in the light block`,
        ).toBe(false);
        expect(
          darkAttrTokens.has(token),
          `${token} is theme-invariant but redefined in [data-theme='dark']`,
        ).toBe(false);
        expect(
          darkMediaTokens.has(token),
          `${token} is theme-invariant but redefined in the prefers-color-scheme block`,
        ).toBe(false);
      }
    });
  });
});
