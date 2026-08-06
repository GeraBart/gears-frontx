import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';

import styles from './badge.module.css';

/*
 * Badge has no Base UI primitive component, but it still gets `render`-prop
 * polymorphism — from `useRender`/`mergeProps`, the same utilities Base UI's
 * primitives are built on. A status badge is usually static, but rendered as
 * a link via `render` it stays focusable and gets the focus ring below.
 *
 * The variant model follows the F-mockups' Badge/Status ("pill or dot;
 * semantic intent only"), which retires the shadcn-inherited
 * default/secondary/destructive/outline/ghost/link list: a badge states
 * *what kind* of thing it marks, not how to paint it. That semantic-only
 * rule is real, but it lives in badge.md and in the VALUE names — the prop
 * itself keeps the kit-wide `variant` name rather than an axis name of its
 * own, so every component in the kit is driven the same way.
 *
 * `shape`, not `size`: the two values are pill vs. bare dot, and Badge has
 * no size axis at all (the pill is a fixed 24px). Not `form` either — that
 * is a real HTML attribute, so a styling prop by that name would shadow it
 * for anyone rendering a form-associated element via `render`. Both shapes
 * carry the colored dot; `pill` adds the fill behind it.
 */
const badgeVariants = cva(styles.badge, {
  variants: {
    variant: {
      success: styles.variantSuccess,
      warning: styles.variantWarning,
      info: styles.variantInfo,
      danger: styles.variantDanger,
      muted: styles.variantMuted,
    },
    shape: {
      pill: styles.shapePill,
      dot: styles.shapeDot,
    },
  },
  defaultVariants: {
    variant: 'muted',
    shape: 'pill',
  },
});

export interface BadgeProps
  extends useRender.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, shape, render, ...props }: BadgeProps) {
  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>({ className: badgeVariants({ variant, shape, className }) }, props),
  });
}
