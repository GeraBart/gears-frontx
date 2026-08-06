import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    // item (guards against alignItemWithTrigger placing an item under the
    // cursor), so the pointerdown must precede the click.
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
});
