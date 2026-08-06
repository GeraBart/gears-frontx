import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Badge } from './badge';
import styles from './badge.module.css';

afterEach(cleanup);

describe('Badge', () => {
  it('renders a span with the base class and the muted pill defaults', () => {
    render(<Badge>New</Badge>);
    const badge = screen.getByText('New');
    expect(badge.tagName).toBe('SPAN');
    expect(badge.className).toContain(styles.badge);
    expect(badge.className).toContain(styles.variantMuted);
    expect(badge.className).toContain(styles.shapePill);
  });

  it.each([
    ['success', styles.variantSuccess],
    ['warning', styles.variantWarning],
    ['info', styles.variantInfo],
    ['danger', styles.variantDanger],
    ['muted', styles.variantMuted],
  ] as const)('applies the %s variant class', (variant, variantClass) => {
    render(<Badge variant={variant}>Label</Badge>);
    expect(screen.getByText('Label').className).toContain(variantClass);
  });

  it('applies the dot shape class', () => {
    render(
      <Badge variant="success" shape="dot">
        Online
      </Badge>,
    );
    const badge = screen.getByText('Online');
    expect(badge.className).toContain(styles.shapeDot);
    expect(badge.className).not.toContain(styles.shapePill);
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(<Badge className="consumer">Tag</Badge>);
    const badge = screen.getByText('Tag');
    expect(badge.className).toContain(styles.badge);
    expect(badge.className).toContain('consumer');
  });

  it('does not leak the variant or shape props to the DOM as attributes', () => {
    render(
      <Badge variant="info" shape="dot">
        Tag
      </Badge>,
    );
    const badge = screen.getByText('Tag');
    expect(badge.hasAttribute('variant')).toBe(false);
    expect(badge.hasAttribute('shape')).toBe(false);
  });

  it('forwards native span props such as data-testid', () => {
    render(<Badge data-testid="status-badge">Active</Badge>);
    expect(screen.getByTestId('status-badge').textContent).toBe('Active');
  });

  it('renders as a different element via the render prop, keeping the kit class', () => {
    render(
      <Badge render={<a href="/filters/open" />} variant="info">
        Open
      </Badge>,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).toHaveProperty('tagName', 'A');
    expect(link).toHaveProperty('href', expect.stringContaining('/filters/open'));
    expect(link.className).toContain(styles.badge);
    expect(link.className).toContain(styles.variantInfo);
  });
});
