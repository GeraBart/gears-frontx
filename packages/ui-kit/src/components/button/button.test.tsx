import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    // The spinner is presentational; the state is carried by aria-busy.
    const spinner = button.querySelector('[aria-hidden="true"]');
    expect(spinner).not.toBeNull();
  });

  it('does not mark an idle button busy or icon-only', () => {
    render(<Button>Idle</Button>);
    const button = screen.getByRole('button', { name: 'Idle' });
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(button.hasAttribute('data-loading')).toBe(false);
    expect(button.hasAttribute('data-icon-only')).toBe(false);
  });
});
