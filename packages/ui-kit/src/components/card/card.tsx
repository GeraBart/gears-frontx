import { cva, cx, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import styles from './card.module.css';

/*
 * Card has no Base UI primitive (registry/base-vega ships plain `div`s with
 * data-slot markers) — this is a pure styling translation over native
 * elements, same shape as Dialog's Header/Footer/Title/Description.
 */

const cardVariants = cva(styles.card, {
  variants: {
    size: {
      default: styles.sizeDefault,
      sm: styles.sizeSm,
    },
  },
  defaultVariants: {
    size: 'default',
  },
});

export type CardProps = ComponentProps<'div'> & VariantProps<typeof cardVariants>;

export function Card({ className, size, ...props }: CardProps) {
  return <div className={cardVariants({ size, className })} {...props} />;
}

export type CardHeaderProps = ComponentProps<'div'>;

export function CardHeader({ className, ...props }: CardHeaderProps) {
  return <div className={cx(styles.cardHeader, className)} {...props} />;
}

export type CardTitleProps = ComponentProps<'div'>;

export function CardTitle({ className, ...props }: CardTitleProps) {
  return <div className={cx(styles.cardTitle, className)} {...props} />;
}

export type CardDescriptionProps = ComponentProps<'div'>;

export function CardDescription({ className, ...props }: CardDescriptionProps) {
  return <div className={cx(styles.cardDescription, className)} {...props} />;
}

/** Positions in the header's second column, spanning both its rows (see CSS). */
export type CardActionProps = ComponentProps<'div'>;

export function CardAction({ className, ...props }: CardActionProps) {
  return <div className={cx(styles.cardAction, className)} {...props} />;
}

export type CardContentProps = ComponentProps<'div'>;

export function CardContent({ className, ...props }: CardContentProps) {
  return <div className={cx(styles.cardContent, className)} {...props} />;
}

export type CardFooterProps = ComponentProps<'div'>;

export function CardFooter({ className, ...props }: CardFooterProps) {
  return <div className={cx(styles.cardFooter, className)} {...props} />;
}
