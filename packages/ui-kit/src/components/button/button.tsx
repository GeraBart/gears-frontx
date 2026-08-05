import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

import styles from './button.module.css';

const buttonVariants = cva(styles.button, {
  variants: {
    variant: {
      default: styles.variantDefault,
      destructive: styles.variantDestructive,
      outline: styles.variantOutline,
      secondary: styles.variantSecondary,
      ghost: styles.variantGhost,
      link: styles.variantLink,
    },
    size: {
      default: styles.sizeDefault,
      sm: styles.sizeSm,
      lg: styles.sizeLg,
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export interface ButtonProps
  extends Omit<ButtonPrimitive.Props, 'className'>, VariantProps<typeof buttonVariants> {
  className?: string;
  /**
   * Leading icon slot — the one right way to put an icon in a Button (never
   * via children; the slot is what gets sized, spaced, hidden during
   * `loading`, and marked decorative). With no children the button turns
   * square icon-only — pass `aria-label` then, the icon carries no
   * accessible name. Same prop shape as react-kit's AcvButton; a trailing
   * slot, if ever needed, takes AcvButton's `end` name.
   */
  icon?: ReactNode;
  /**
   * Shows a centered spinner and disables the button. Content is hidden
   * with opacity, not visibility: it keeps painting the button's size (no
   * width jump) and, unlike visibility, stays in the accessibility tree —
   * the button keeps its name while `aria-busy` reports the state, with no
   * hardcoded "Loading" label the kit would otherwise have to translate.
   */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  icon,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  // Icon-only is derived, not declared: an icon with no children is the
  // whole content, so the button squares up (react-kit's AcvButton
  // auto-detects the same way).
  const iconOnly = icon != null && children == null;
  return (
    <ButtonPrimitive
      className={buttonVariants({ variant, size, className })}
      data-icon-only={iconOnly || undefined}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {icon != null && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      {children != null && <span className={styles.label}>{children}</span>}
    </ButtonPrimitive>
  );
}
