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
    expect(badge.className).toContain(styles.intentMuted);
    expect(badge.className).toContain(styles.formPill);
  });

  it.each([
    ['success', styles.intentSuccess],
    ['warning', styles.intentWarning],
    ['info', styles.intentInfo],
    ['danger', styles.intentDanger],
    ['muted', styles.intentMuted],
  ] as const)('applies the %s intent class', (intent, intentClass) => {
    render(<Badge intent={intent}>Label</Badge>);
    expect(screen.getByText('Label').className).toContain(intentClass);
  });

  it('applies the dot form class', () => {
    render(
      <Badge intent="success" form="dot">
        Online
      </Badge>,
    );
    const badge = screen.getByText('Online');
    expect(badge.className).toContain(styles.formDot);
    expect(badge.className).not.toContain(styles.formPill);
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(<Badge className="consumer">Tag</Badge>);
    const badge = screen.getByText('Tag');
    expect(badge.className).toContain(styles.badge);
    expect(badge.className).toContain('consumer');
  });

  it('does not leak the intent or form props to the DOM as attributes', () => {
    render(
      <Badge intent="info" form="dot">
        Tag
      </Badge>,
    );
    const badge = screen.getByText('Tag');
    expect(badge.hasAttribute('intent')).toBe(false);
    expect(badge.hasAttribute('form')).toBe(false);
  });

  it('forwards native span props such as data-testid', () => {
    render(<Badge data-testid="status-badge">Active</Badge>);
    expect(screen.getByTestId('status-badge').textContent).toBe('Active');
  });

  it('renders as a different element via the render prop, keeping the kit class', () => {
    render(
      <Badge render={<a href="/filters/open" />} intent="info">
        Open
      </Badge>,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).toHaveProperty('tagName', 'A');
    expect(link).toHaveProperty('href', expect.stringContaining('/filters/open'));
    expect(link.className).toContain(styles.badge);
    expect(link.className).toContain(styles.intentInfo);
  });
});
