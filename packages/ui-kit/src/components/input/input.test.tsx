import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Input } from './input';
import styles from './input.module.css';

afterEach(cleanup);

describe('Input', () => {
  it('renders a native input with the base class', () => {
    const { container } = render(<Input placeholder="Search" />);
    const input = screen.getByPlaceholderText('Search');
    expect(input).toHaveProperty('tagName', 'INPUT');
    expect(input.className).toContain(styles.input);
    // No slots — no wrapper element: the input is the root.
    expect(input.parentElement).toBe(container);
  });

  it('type="search" no longer decorates itself', () => {
    const { container } = render(<Input type="search" placeholder="Find" />);
    const input = screen.getByRole('searchbox');
    // Still a bare input (the searchbox role comes from the native type);
    // the magnifier is gone — icons are always explicit now.
    expect(input.parentElement).toBe(container);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('icon renders in a decorative leading slot and pads the input', () => {
    render(<Input icon={<svg data-testid="magnifier" />} placeholder="Find" className="consumer" />);
    const input = screen.getByPlaceholderText('Find');
    expect(input.parentElement?.className).toContain(styles.wrap);
    expect(input.className).toContain(styles.hasIcon);
    // The consumer className stays on the input itself, wrapper or not.
    expect(input.className).toContain('consumer');
    const slot = screen.getByTestId('magnifier').parentElement;
    expect(slot).toHaveProperty('tagName', 'SPAN');
    expect(slot?.className).toContain(styles.icon);
    expect(slot?.getAttribute('aria-hidden')).toBe('true');
  });

  it('end renders an interactive trailing slot after the input in the DOM', () => {
    const onClear = vi.fn();
    render(
      <Input
        placeholder="Find"
        end={<button type="button" aria-label="Clear" onClick={onClear} />}
      />,
    );
    const input = screen.getByPlaceholderText('Find');
    expect(input.className).toContain(styles.hasEnd);
    const clear = screen.getByRole('button', { name: 'Clear' });
    // Live content, not aria-hidden decoration — and placed after the
    // input, so tab order is field first, then the slot.
    expect(clear.closest(`.${styles.end}`)).not.toBeNull();
    expect(input.nextElementSibling?.contains(clear)).toBe(true);
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('renders both slots at once', () => {
    render(<Input placeholder="Find" icon={<svg data-testid="lead" />} end={<span data-testid="trail" />} />);
    const input = screen.getByPlaceholderText('Find');
    expect(screen.getByTestId('lead')).toBeTruthy();
    expect(screen.getByTestId('trail')).toBeTruthy();
    expect(input.className).toContain(styles.hasIcon);
    expect(input.className).toContain(styles.hasEnd);
  });

  it('reports value changes through onValueChange', () => {
    const onValueChange = vi.fn();
    render(<Input onValueChange={onValueChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'gears' } });
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0]?.[0]).toBe('gears');
  });

  it('merges a consumer className and forwards native props', () => {
    render(<Input className="consumer" type="email" defaultValue="a@b.c" required />);
    const input = screen.getByRole('textbox');
    expect(input.className).toContain(styles.input);
    expect(input.className).toContain('consumer');
    expect(input).toHaveProperty('type', 'email');
    expect(input).toHaveProperty('value', 'a@b.c');
    expect(input).toHaveProperty('required', true);
  });

  it('forwards the invalid state', () => {
    render(<Input aria-invalid={true} />);
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
  });

  it('marks the input disabled', () => {
    // Asserts the attribute, not "the change handler never fired": jsdom's
    // fireEvent dispatches a change event directly, bypassing the browser
    // input pipeline that a real disabled attribute blocks — it fires the
    // handler regardless, so a spy assertion here would pass or fail for
    // reasons unrelated to Input's own behavior. What this component
    // controls, and what a real browser enforces the rest of the way, is
    // the native `disabled` attribute itself — so there is no spy to pass.
    render(<Input disabled />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveProperty('disabled', true);
  });
});
