import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { contrastRatio } from '../../__test-utils__/contrast';
import { declarationMap, extractRules } from '../../__test-utils__/css-rules';
import { readThemeTokens } from '../../__test-utils__/theme-tokens';
import { Button } from './button';
import styles from './button.module.css';

afterEach(cleanup);

describe('Button', () => {
  it('renders a button with its content and base class', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.className).toContain(styles.button);
    expect(button).toHaveProperty('type', 'button');
  });

  it('applies variant and size classes from the CSS module', () => {
    render(
      <Button variant="outline" size="sm">
        Cancel
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Cancel' });
    expect(button.className).toContain(styles.variantOutline);
    expect(button.className).toContain(styles.sizeSm);
  });

  it('defaults to the primary variant and medium size', () => {
    render(<Button>Go</Button>);
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button.className).toContain(styles.variantDefault);
    expect(button.className).toContain(styles.sizeDefault);
  });

  it('merges a consumer className and forwards props', () => {
    const onClick = vi.fn();
    render(
      <Button className="consumer" onClick={onClick} disabled={false}>
        Click
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Click' });
    expect(button.className).toContain('consumer');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a custom element via the render prop', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <Button render={<a href="/docs" />} nativeButton={false} variant="link">
        Docs
      </Button>,
    );
    // Base UI applies button semantics to the anchor: role="button", real href.
    const link = screen.getByRole('button', { name: 'Docs' });
    expect(link).toHaveProperty('tagName', 'A');
    expect(link).toHaveProperty('href', expect.stringContaining('/docs'));
    expect(link.className).toContain(styles.button);
    expect(link.className).toContain(styles.variantLink);
    // nativeButton={false} keeps Base UI's non-native-button warning silent.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('does not fire clicks when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Nope
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Nope' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders the icon slot as decorative and keeps the label as the name', () => {
    render(
      <Button icon={<svg data-testid="plus" />}>
        Add
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Add' });
    const slot = screen.getByTestId('plus').parentElement;
    expect(slot).toHaveProperty('tagName', 'SPAN');
    expect(slot?.getAttribute('aria-hidden')).toBe('true');
    // Icon next to a label is a regular button, not an icon-only one.
    expect(button.hasAttribute('data-icon-only')).toBe(false);
  });

  it('squares up when the icon slot is the only content', () => {
    render(<Button icon={<svg />} aria-label="Close" />);
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button.hasAttribute('data-icon-only')).toBe(true);
  });

  it('loading disables the button, reports aria-busy, and keeps the accessible name', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} loading>
        Save
      </Button>,
    );
    // The name must survive loading: content is hidden with opacity, which
    // stays in the accessibility tree (visibility would strip the name).
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    // aria-disabled, not the native `disabled` attribute: a real `disabled`
    // would blur the element the instant it landed and pull it out of the
    // tab order, leaving aria-busy announced to nothing (see the dedicated
    // focus test below). Clicks are still suppressed either way.
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button).toHaveProperty('disabled', false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    // The spinner specifically, not just "some aria-hidden descendant" —
    // the icon slot is aria-hidden too, and a selector that only checks
    // that attribute would pass even if the spinner never rendered.
    const spinner = Array.from(button.querySelectorAll('span')).find((el) =>
      el.classList.contains(styles.spinner),
    );
    expect(spinner).not.toBeUndefined();
  });

  it('does not mark an idle button busy or icon-only', () => {
    render(<Button>Idle</Button>);
    const button = screen.getByRole('button', { name: 'Idle' });
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(button.hasAttribute('data-loading')).toBe(false);
    expect(button.hasAttribute('data-icon-only')).toBe(false);
  });

  it('squares up for a falsy label even with an icon and children both present', () => {
    // `{cond && 'Save'}` is a real, common pattern (a conditional label) —
    // `children == null` misses it because `false` is neither null nor
    // undefined, so the button rendered a wide pill with an empty label
    // span instead of going icon-only.
    const showLabel = false;
    render(
      <Button icon={<svg />} aria-label="Create">
        {showLabel && 'Create'}
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Create' });
    expect(button.hasAttribute('data-icon-only')).toBe(true);
  });

  it('stays icon-only while loading', () => {
    render(<Button icon={<svg />} loading aria-label="Refresh" />);
    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(button.hasAttribute('data-icon-only')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('keeps a loading button focusable instead of blurring it', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    button.focus();
    expect(document.activeElement).toBe(button);
    // Base UI reports the state via aria-disabled while focusableWhenDisabled
    // is in effect, not the native `disabled` attribute — a real `disabled`
    // attribute would have blurred the element the instant it landed.
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('lets its own derived state win over a conflicting prop of the same name', () => {
    // A caller passing aria-busy/data-loading that disagrees with the
    // actual `loading` prop must not shadow the derived value — Button
    // computed loading=true, so that wins regardless of prop order.
    render(
      <Button loading aria-busy={false} data-loading="">
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('data-loading')).toBe('true');
  });
});

/*
 * Focus-ring contrast guard (A1), moved here from tokens.test.ts: unlike
 * the link-text/table-header cases that stayed there (genuinely theme-
 * level pairs), a Button focus ring is DERIVED from two things this file
 * already owns — which token button.module.css's --button-focus-ring{,
 * -inner} actually resolve to per variant, and which token that variant's
 * own `background-color` resolves to. Hardcoding "default's ring is --info
 * against --primary" here would restate the CSS instead of reading it: if
 * a future edit re-points --button-focus-ring, this guard needs to notice
 * on its own, not keep asserting yesterday's mapping. So it parses the raw
 * button.module.css source (not the hashed `styles` import, which has no
 * selector names or values left in it) with the same extractRules the
 * theme.css guards use, resolves each variant's custom-property cascade by
 * hand (button.module.css declares --button-focus-ring{,-inner} in more
 * than one rule per variant — a rest-fill rule and a separate focus-color
 * rule further down the file — so "merge every matching rule in source
 * order" is what actually reproduces the cascade, not a single lookup).
 */
describe('Button focus-ring contrast', () => {
  const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'button.module.css');
  const rules = extractRules(readFileSync(cssPath, 'utf8'));
  const { light, dark } = readThemeTokens();

  // Every declaration from every rule whose selector list includes `.button`
  // (the shared base) or `targetClass`, applied in source order — the same
  // property from a later rule overrides an earlier one, same as the
  // cascade would resolve two same-specificity rules for the same class.
  function effectiveDeclarations(targetClass: string): Map<string, string> {
    const merged = new Map<string, string>();
    for (const rule of rules) {
      const selectors = rule.selector.split(',').map((selector) => selector.replace(/\s+/g, ''));
      if (selectors.includes('.button') || selectors.includes(targetClass)) {
        for (const [prop, value] of declarationMap(rule.body)) {
          merged.set(prop, value);
        }
      }
    }
    return merged;
  }

  function localVarName(value: string): string | null {
    return value.trim().match(/^var\((--[a-z0-9-]+)\)$/)?.[1] ?? null;
  }

  // Peels away button.module.css's OWN indirection (--button-focus-ring-
  // inner defaulting to `var(--button-focus-ring)`, or one variant class
  // pointing at another local custom property) until the value names a
  // token that ISN'T declared in `scope` — at that point it can only be a
  // real theme.css token, which is what every caller here actually wants.
  function resolveThemeToken(rawValue: string, scope: Map<string, string>): string | null {
    let current = rawValue.trim();
    const seen = new Set<string>();
    for (;;) {
      const name = localVarName(current);
      if (!name) return null; // not a var() at all (e.g. a literal color, `transparent`)
      if (!scope.has(name)) return name;
      if (seen.has(name)) return null; // cycle guard — should never trigger
      seen.add(name);
      current = scope.get(name) as string;
    }
  }

  const variants = [
    'variantDefault',
    'variantDestructive',
    'variantOutline',
    'variantSecondary',
    'variantGhost',
    'variantLink',
  ];

  const themes: Array<[string, Map<string, string>]> = [
    ['light', light],
    ['dark', dark],
  ];

  // Resolves a possibly-null token NAME (from resolveThemeToken) to its
  // literal hex VALUE in a given theme block, failing loudly at either step
  // instead of silently comparing `undefined` against something — the same
  // "assert then narrow" shape as tokens.test.ts's own `token()` helper.
  function hexFor(name: string | null, tokens: Map<string, string>, label: string): string {
    expect(name, `${label} did not resolve to a theme token`).not.toBeNull();
    const hex = tokens.get(name as string);
    expect(hex, `${name} missing from the theme block being checked`).toBeDefined();
    return hex as string;
  }

  it.each(variants)('%s clears 3:1 against both the fill and the page background', (variant) => {
    const scope = effectiveDeclarations(`.${variant}`);
    const outerName = resolveThemeToken(scope.get('--button-focus-ring') ?? '', scope);
    const innerName = resolveThemeToken(scope.get('--button-focus-ring-inner') ?? '', scope);
    // Only --background is checked as the "page background" side — the
    // one surface every variant is documented/drawn to sit on. A variant
    // placed on --card/--surface instead is unverified; scoped to the one
    // pair the brief actually asks about, not widened into a full matrix.
    const fillName = resolveThemeToken(scope.get('background-color') ?? '', scope);
    for (const [themeName, tokens] of themes) {
      const background = hexFor('--background', tokens, '--background');
      const outerHex = hexFor(outerName, tokens, `${variant}'s --button-focus-ring`);
      const innerHex = hexFor(innerName, tokens, `${variant}'s --button-focus-ring-inner`);
      // A `transparent` (or otherwise unresolved) fill means the variant
      // has no fill of its own — ghost/link's actual backdrop is the page
      // itself, so the "fill" side of the check collapses onto --background.
      const fillHex = fillName ? hexFor(fillName, tokens, `${variant}'s background-color`) : background;
      expect(
        contrastRatio(outerHex, background),
        `${themeName} ${variant} outer vs page bg`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrastRatio(innerHex, fillHex),
        `${themeName} ${variant} inner vs fill`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
