import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cx } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { Button } from '../button/button';
import styles from './dialog.module.css';

/* Inline lucide path (ISC) — the kit carries no icon dependency. */
function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cx(styles.svgIcon, className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export const Dialog = DialogPrimitive.Root;
/**
 * The root is a Base UI pass-through, but its props type is still exported:
 * a consumer writing a typed wrapper imports it from this kit — Base UI is
 * this package's dependency, not necessarily theirs. Same idiom as
 * TooltipProviderProps.
 */
export type DialogProps = DialogPrimitive.Root.Props;

export interface DialogTriggerProps extends Omit<DialogPrimitive.Trigger.Props, 'className'> {
  className?: string;
}

export function DialogTrigger({ className, ...props }: DialogTriggerProps) {
  return <DialogPrimitive.Trigger className={className} {...props} />;
}

export interface DialogCloseProps extends Omit<DialogPrimitive.Close.Props, 'className'> {
  className?: string;
}

export function DialogClose({ className, ...props }: DialogCloseProps) {
  return <DialogPrimitive.Close className={className} {...props} />;
}

export interface DialogContentProps extends Omit<DialogPrimitive.Popup.Props, 'className'> {
  className?: string;
  /**
   * Where to portal the popup. Defaults to <body>. Pass a themed container
   * when the theme is scoped to a subtree (data-theme on a container that
   * isn't at document root) so the popup inherits its tokens and font.
   */
  container?: DialogPrimitive.Portal.Props['container'];
  /** Renders a top-right close (X) button inside the popup. @default true */
  showCloseButton?: boolean;
  /**
   * Accessible name for the built-in close (X) button — the popup's only
   * kit-authored text, so the one string a non-English app needs to
   * replace. Same contract as Toaster's closeLabel. @default 'Close'
   */
  closeLabel?: string;
}

export function DialogContent({
  className,
  children,
  container,
  showCloseButton = true,
  closeLabel = 'Close',
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal container={container}>
      <DialogPrimitive.Backdrop className={styles.backdrop} />
      <DialogPrimitive.Popup className={cx(styles.popup, className)} {...props}>
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            className={styles.closeButton}
            render={<Button variant="ghost" size="icon" />}
          >
            <CloseIcon />
            <span className={styles.srOnly}>{closeLabel}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export type DialogHeaderProps = ComponentProps<'div'>;

export function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return <div className={cx(styles.header, className)} {...props} />;
}

export type DialogFooterProps = ComponentProps<'div'>;

export function DialogFooter({ className, ...props }: DialogFooterProps) {
  return <div className={cx(styles.footer, className)} {...props} />;
}

export interface DialogTitleProps extends Omit<DialogPrimitive.Title.Props, 'className'> {
  className?: string;
}

export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return <DialogPrimitive.Title className={cx(styles.title, className)} {...props} />;
}

export interface DialogDescriptionProps
  extends Omit<DialogPrimitive.Description.Props, 'className'> {
  className?: string;
}

export function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return <DialogPrimitive.Description className={cx(styles.description, className)} {...props} />;
}
