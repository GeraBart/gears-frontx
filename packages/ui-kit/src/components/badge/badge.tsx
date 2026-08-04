import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';

import styles from './badge.module.css';

/*
 * Badge has no Base UI primitive component, but the registry's own Badge
 * still gets `render`-prop polymorphism — from `useRender`/`mergeProps`,
 * the same utilities Base UI's primitives are built on, not from wrapping a
 * primitive. That's a deliberate kit choice, not an accident of the source:
 * the registry's CSS specifically arms hover styling behind an `:is(a)`
 * check (see badge.module.css), i.e. a badge only looks interactive once it
 * actually renders as a link via `render`. Card, by contrast, has no `render`
 * prop at all because none of its parts are ever meant to be interactive.
 */
const badgeVariants = cva(styles.badge, {
  variants: {
    variant: {
      default: styles.variantDefault,
      secondary: styles.variantSecondary,
      destructive: styles.variantDestructive,
      outline: styles.variantOutline,
      ghost: styles.variantGhost,
      link: styles.variantLink,
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface BadgeProps
  extends useRender.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, render, ...props }: BadgeProps) {
  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>({ className: badgeVariants({ variant, className }) }, props),
  });
}
