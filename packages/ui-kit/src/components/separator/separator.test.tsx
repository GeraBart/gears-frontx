import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Separator } from './separator';
import styles from './separator.module.css';

afterEach(cleanup);

describe('Separator', () => {
  it('renders a div with role="separator" and the base class, defaulting to horizontal', () => {
    render(<Separator data-testid="sep" />);
    const separator = screen.getByTestId('sep');
    expect(separator).toHaveProperty('tagName', 'DIV');
    expect(separator.getAttribute('role')).toBe('separator');
    expect(separator.getAttribute('aria-orientation')).toBe('horizontal');
    expect(separator.getAttribute('data-orientation')).toBe('horizontal');
    expect(separator.className).toContain(styles.separator);
  });

  it('switches to vertical via the orientation prop', () => {
    render(<Separator orientation="vertical" data-testid="sep" />);
    const separator = screen.getByTestId('sep');
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('data-orientation')).toBe('vertical');
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(<Separator className="consumer" data-testid="sep" />);
    const separator = screen.getByTestId('sep');
    expect(separator.className).toContain(styles.separator);
    expect(separator.className).toContain('consumer');
  });

  it('lets a consumer opt into a decorative divider via aria-hidden', () => {
    // Base UI's Separator has no `decorative` prop (unlike Radix); a
    // purely visual divider is opted into by passing aria-hidden
    // directly, which wins because elementProps merges in last — see the
    // comment in separator.tsx for the mergeProps evidence. Not paired
    // with role="none" here: aria-orientation stays set regardless of
    // role, so that combination is an aria-allowed-attr violation — see
    // separator.md's "Decorative vs. semantic separators".
    render(<Separator aria-hidden="true" data-testid="sep" />);
    const separator = screen.getByTestId('sep');
    expect(separator.getAttribute('aria-hidden')).toBe('true');
    // role stays "separator" underneath — irrelevant once aria-hidden
    // removes the element from the accessibility tree entirely.
    expect(separator.getAttribute('role')).toBe('separator');
    // Pins the actual accessibility outcome, not just the DOM attribute:
    // RTL's byRole respects aria-hidden by default, so this proves the
    // element left the a11y tree, not merely that the attribute is set.
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('forwards native div props such as id', () => {
    render(<Separator id="section-divider" data-testid="sep" />);
    expect(screen.getByTestId('sep')).toHaveProperty('id', 'section-divider');
  });
});
