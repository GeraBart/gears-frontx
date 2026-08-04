import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Skeleton } from './skeleton';
import styles from './skeleton.module.css';

afterEach(cleanup);

describe('Skeleton', () => {
  it('renders a div with the base class', () => {
    render(<Skeleton data-testid="skel" />);
    const skeleton = screen.getByTestId('skel');
    expect(skeleton).toHaveProperty('tagName', 'DIV');
    expect(skeleton.className).toContain(styles.skeleton);
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(<Skeleton className="consumer" data-testid="skel" />);
    const skeleton = screen.getByTestId('skel');
    expect(skeleton.className).toContain(styles.skeleton);
    expect(skeleton.className).toContain('consumer');
  });

  it('adds no ARIA of its own, leaving loading semantics to the consumer', () => {
    // Matches base-vega (no ARIA on its Skeleton) and the kit's standing
    // policy (see Separator): no ARIA is invented where neither the source
    // nor a Base UI primitive supplies one.
    render(<Skeleton data-testid="skel" />);
    const skeleton = screen.getByTestId('skel');
    expect(skeleton.getAttribute('role')).toBeNull();
    expect(skeleton.getAttribute('aria-hidden')).toBeNull();
    expect(skeleton.getAttribute('aria-busy')).toBeNull();
  });

  it('lets a consumer opt an instance out of the accessibility tree via aria-hidden', () => {
    render(<Skeleton aria-hidden="true" data-testid="skel" />);
    expect(screen.getByTestId('skel').getAttribute('aria-hidden')).toBe('true');
  });

  it('forwards native div props such as id', () => {
    render(<Skeleton id="avatar-placeholder" data-testid="skel" />);
    expect(screen.getByTestId('skel')).toHaveProperty('id', 'avatar-placeholder');
  });
});
