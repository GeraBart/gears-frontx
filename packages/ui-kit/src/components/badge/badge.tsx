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
 * *what kind* of thing it marks (intent), not how to paint it. Both forms
 * carry the colored dot; `pill` adds the soft fill behind it.
 */
const badgeVariants = cva(styles.badge, {
  variants: {
    intent: {
      success: styles.intentSuccess,
      warning: styles.intentWarning,
      info: styles.intentInfo,
      danger: styles.intentDanger,
      muted: styles.intentMuted,
    },
    form: {
      pill: styles.formPill,
      dot: styles.formDot,
    },
  },
  defaultVariants: {
    intent: 'muted',
    form: 'pill',
  },
});

export interface BadgeProps
  extends useRender.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, intent, form, render, ...props }: BadgeProps) {
  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>({ className: badgeVariants({ intent, form, className }) }, props),
  });
}
