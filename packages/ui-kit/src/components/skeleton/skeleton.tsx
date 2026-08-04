import { cx } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import styles from './skeleton.module.css';

/*
 * Skeleton has no Base UI primitive (registry/base-vega ships a plain `div`
 * with a data-slot marker) — this is a pure styling translation over a
 * native element, same shape as Card (see card.tsx).
 *
 * No ARIA is added here. base-vega's own Skeleton carries none, and Base UI
 * has no primitive to defer to either — the same standing policy Separator
 * established: this kit does not invent an ARIA prop neither the source nor
 * a primitive supplies. A skeleton is a purely visual placeholder; the
 * loading semantics (`role="status"`, `aria-busy`, an accessible loading
 * announcement) belong on the consumer's surrounding container, which knows
 * when the whole region starts and stops loading — a single Skeleton div
 * does not. See skeleton.md's Accessibility section for what to wire up
 * there, and for opting an individual instance out of the accessibility
 * tree via `aria-hidden` (forwarded like any other prop, no special
 * handling needed).
 */
export type SkeletonProps = ComponentProps<'div'>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return <div className={cx(styles.skeleton, className)} {...props} />;
}
