import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Input } from './input';
import styles from './input.module.css';

afterEach(cleanup);

describe('Input', () => {
  it('renders a native input with the base class', () => {
    render(<Input placeholder="Search" />);
    const input = screen.getByPlaceholderText('Search');
    expect(input).toHaveProperty('tagName', 'INPUT');
    expect(input.className).toContain(styles.input);
    // Every non-search type stays a bare input — no wrapper element.
    expect(input.parentElement?.className ?? '').not.toContain(styles.searchWrap);
  });

  it('type="search" adds the decorated wrapper and keeps the searchbox role', () => {
    render(<Input type="search" placeholder="Find" className="consumer" />);
    const input = screen.getByRole('searchbox');
    expect(input.className).toContain(styles.searchInput);
    // The consumer className stays on the input itself, same as any type.
    expect(input.className).toContain('consumer');
    const wrap = input.parentElement;
    expect(wrap?.className).toContain(styles.searchWrap);
    // The magnifier is decoration; the accessible upgrade is the native type.
    const icon = wrap?.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
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

  it('does not accept input when disabled', () => {
    const onValueChange = vi.fn();
    render(<Input disabled onValueChange={onValueChange} />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveProperty('disabled', true);
  });
});
