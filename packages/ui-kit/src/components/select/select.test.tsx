import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declarationMap, extractRules } from '../../__test-utils__/css-rules';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';
import styles from './select.module.css';

afterEach(cleanup);

const ITEMS = [
  { value: 'eu', label: 'Europe' },
  { value: 'us', label: 'Americas' },
];

function renderSelect(rootProps: Parameters<typeof Select>[0] = {}) {
  return render(
    <Select items={ITEMS} {...rootProps}>
      <SelectTrigger aria-label="Region">
        <SelectValue placeholder="Pick a region" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="eu">Europe</SelectItem>
          <SelectItem value="us">Americas</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>,
  );
}

describe('Select', () => {
  it('renders a closed trigger with the placeholder and kit classes', () => {
    renderSelect();
    const trigger = screen.getByRole('combobox', { name: 'Region' });
    expect(trigger.className).toContain(styles.trigger);
    expect(trigger.className).toContain(styles.sizeDefault);
    // The negative half of the variant axis: `.variantFilter` overrides
    // `.sizeDefault`'s height by source order, so a regression that applied
    // the class unconditionally would silently shrink every default trigger
    // from 40px to 36px while the positive test below kept passing.
    expect(trigger.className).not.toContain(styles.variantFilter);
    expect(trigger.textContent).toContain('Pick a region');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows options when open and marks items with kit classes', () => {
    renderSelect({ defaultOpen: true });
    expect(screen.getByRole('listbox')).toBeTruthy();
    const option = screen.getByRole('option', { name: 'Europe' });
    expect(option.className).toContain(styles.item);
  });

  it('selects an option and reports through onValueChange', () => {
    const onValueChange = vi.fn();
    renderSelect({ defaultOpen: true, onValueChange });
    const option = screen.getByRole('option', { name: 'Europe' });
    // Base UI commits a mouse selection only when the click started on the
    // item (guards against a stray pointerup landing on an item that wasn't
    // clicked), so the pointerdown must precede the click.
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0]?.[0]).toBe('eu');
  });

  it('renders the selected value in the trigger', () => {
    renderSelect({ defaultValue: 'us' });
    expect(screen.getByRole('combobox', { name: 'Region' }).textContent).toContain('Americas');
  });

  it('portals the popup into a provided container', () => {
    const container = document.createElement('div');
    container.id = 'themed-section';
    document.body.appendChild(container);
    render(
      <Select items={ITEMS} defaultOpen>
        <SelectTrigger aria-label="Region">
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent container={container}>
          <SelectGroup>
            <SelectItem value="eu">Europe</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    );
    const listbox = screen.getByRole('listbox');
    expect(container.contains(listbox)).toBe(true);
    container.remove();
  });

  it('applies the sm trigger size', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Compact" size="sm">
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="a">A</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByRole('combobox', { name: 'Compact' }).className).toContain(styles.sizeSm);
  });

  it('applies the filter trigger variant', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Status filter" variant="filter">
          <SelectValue placeholder="Filter" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="a">A</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Status filter' });
    expect(trigger.className).toContain(styles.variantFilter);
    // The prop is a styling axis, not a DOM attribute.
    expect(trigger.hasAttribute('variant')).toBe(false);
  });

  it('pads the list directly, so items placed without a SelectGroup are still inset', () => {
    render(
      <Select items={ITEMS} defaultOpen>
        <SelectTrigger aria-label="Region">
          <SelectValue placeholder="Pick a region" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="eu">Europe</SelectItem>
          <SelectItem value="us">Americas</SelectItem>
        </SelectContent>
      </Select>,
    );
    const listbox = screen.getByRole('listbox');
    expect(listbox.className).toContain(styles.list);
  });

  it('always opens the popup below the trigger, with no align-with-trigger attribute', () => {
    renderSelect({ defaultOpen: true });
    const popup = screen.getByRole('listbox').closest(`.${styles.popup}`);
    // The popup exists and no longer advertises the retired overlay mode —
    // the attribute is gone entirely, not set to "false".
    expect(popup).not.toBeNull();
    expect(popup?.hasAttribute('data-align-trigger')).toBe(false);
  });
});

/*
 * jsdom computes no layout, so the scroll-arrow fix itself (does the list
 * actually scroll and clear the selected item, do the arrows mount at the
 * right edges) can only be verified in a real browser — see the manual
 * verification in this change's PR/report, not a test here. What CAN be
 * guarded statically is the one thing that could silently regress without
 * any layout at all: .list's `scroll-padding-block` and .scrollArrow's
 * `height` each declare their OWN copy of `--select-scroll-arrow-height`
 * (tokens.test.ts's local-variable guard scopes a declared custom property
 * to its own leading class, so one rule can't read the other's declaration
 * — see select.module.css's comment on .list). Nothing enforces that the
 * two copies stay identical except this test, which parses the raw CSS
 * source directly (not the hashed `styles` import, which has no values left
 * in it) — the same technique button.test.tsx's focus-ring guard uses.
 */
describe('Select scroll-arrow height', () => {
  const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'select.module.css');
  const rules = extractRules(readFileSync(cssPath, 'utf8'));

  function declaredValue(leadingClass: string, prop: string): string | undefined {
    const rule = rules.find((candidate) => candidate.selector.split(',')[0]?.trim() === leadingClass);
    return rule ? declarationMap(rule.body).get(prop) : undefined;
  }

  it('declares the identical --select-scroll-arrow-height formula on .list and .scrollArrow', () => {
    const listValue = declaredValue('.list', '--select-scroll-arrow-height');
    const scrollArrowValue = declaredValue('.scrollArrow', '--select-scroll-arrow-height');
    expect(listValue, '.list is missing --select-scroll-arrow-height').toBeDefined();
    expect(listValue).toBe(scrollArrowValue);
  });

  it('reads that property from .list scroll-padding-block and .scrollArrow height', () => {
    expect(declaredValue('.list', 'scroll-padding-block')).toBe('var(--select-scroll-arrow-height)');
    expect(declaredValue('.scrollArrow', 'height')).toBe('var(--select-scroll-arrow-height)');
  });

  // Without this, the height above is a content-box size and .scrollArrow's
  // own padding would add on top of it, rendering the arrow taller than the
  // scroll padding .list reserves for it — the exact regression the browser
  // check caught before this was added.
  it('keeps .scrollArrow border-box so its height absorbs its own padding', () => {
    expect(declaredValue('.scrollArrow', 'box-sizing')).toBe('border-box');
  });
});
