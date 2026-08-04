import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import { cx } from 'class-variance-authority';

import { Button } from '../button/button';
import styles from './toast.module.css';

/*
 * Inline lucide paths (ISC) — the kit carries no icon dependency. One icon
 * per toast `type`; an unset/unrecognized type renders no icon, matching
 * the base-vega source's <ToastIcon>.
 */
function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cx(styles.icon, className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cx(styles.icon, className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function TriangleAlertIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cx(styles.icon, className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function OctagonXIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cx(styles.icon, className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m15 9-6 6" />
      <path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

function LoaderIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cx(styles.icon, className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

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

function ToastTypeIcon({ type }: { type: string | undefined }) {
  switch (type) {
    case 'success':
      return <CheckCircleIcon />;
    case 'info':
      return <InfoIcon />;
    case 'warning':
      return <TriangleAlertIcon />;
    case 'error':
      return <OctagonXIcon className={styles.iconDestructive} />;
    case 'loading':
      return <LoaderIcon className={styles.iconSpin} />;
    default:
      return null;
  }
}

/*
 * One rendered toast card. Not exported — a `Toast` type prop drives the
 * icon and (via CSS `data-type`) any future type-specific styling, but the
 * kit's usage model is imperative (`toast.add({...})`, see below), not
 * composing a `<Toast>` per notification the way `Dialog`/`DropdownMenu`
 * are composed. `ToastPrimitive.Title`/`Description`/`Action` all read
 * their content from the `toast` object via context and render nothing if
 * it's unset — no children needed here.
 */
function ToastCard({ toast: item }: { toast: ToastPrimitive.Root.ToastObject }) {
  return (
    <ToastPrimitive.Root toast={item} className={styles.toast}>
      <ToastPrimitive.Content className={styles.content}>
        <ToastTypeIcon type={item.type} />
        <div className={styles.body}>
          <ToastPrimitive.Title className={styles.title} />
          <ToastPrimitive.Description className={styles.description} />
        </div>
        <ToastPrimitive.Action className={styles.action} render={<Button variant="outline" size="sm" />} />
        <ToastPrimitive.Close
          aria-label="Close toast"
          className={styles.close}
          render={<Button variant="ghost" size="icon" />}
        >
          <CloseIcon />
        </ToastPrimitive.Close>
      </ToastPrimitive.Content>
    </ToastPrimitive.Root>
  );
}

/* Reads the live toast list from context and renders one ToastCard each. */
function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();
  return toasts.map((item) => <ToastCard key={item.id} toast={item} />);
}

/**
 * Shared imperative toast manager: call `toast.add({ title, description })`
 * (or `.close()`, `.update()`, `.promise()`) from anywhere in the app —
 * no hook, and no ancestor `Toaster`/`ToastProvider`, required to fire
 * one. `Toaster` renders whatever this manager holds by default.
 *
 * A module-scope singleton is a deliberate choice, not the only shape Base
 * UI's Toast offers (see `createToastManager`/`useToastManager` below): it
 * keeps sonner's own call-anywhere `toast()` ergonomics (see
 * design-notes.md for why Base UI's Toast replaced sonner) without needing
 * a component to be inside a Provider's subtree or accept a manager prop.
 *
 * Two failure modes worth knowing about a singleton, both silent: it's
 * SSR-safe (the object above holds no toast state itself, only a listener
 * registered by whichever `Toaster` mounts), but `toast.add(...)` called
 * before any `Toaster` has mounted, or from code that resolved a
 * different copy of this module (e.g. a mixed CJS/ESM require graph),
 * drops the toast with no error — there is no queue and nothing to catch.
 */
export const toast = ToastPrimitive.createToastManager();

/**
 * Reads the live toast list and the `add`/`close`/`update`/`promise`
 * bound to whichever manager the nearest `Toaster` ancestor was given
 * (the shared `toast` singleton unless overridden) — from a component
 * nested under `Toaster`, this is how you react to the toast list itself
 * (e.g. an unread-count badge) or call that same manager without
 * importing it directly. Not a way to render toast cards in place of
 * `Toaster`: the kit exports no Root/Content/Title/etc. parts to build
 * one with, and a separately-installed `@base-ui/react` in a consumer
 * app can't share this context either — Base UI is bundled into this
 * package's own build, not left as the consumer's dependency to resolve.
 */
export const useToastManager = ToastPrimitive.useToastManager;

/**
 * Creates an isolated toast manager, independent of the shared `toast`
 * singleton — e.g. to scope a second, differently-positioned `Toaster` to
 * one part of the app instead of sharing the app-wide instance. Pass the
 * result as `toastManager` to `Toaster`.
 */
export const createToastManager = ToastPrimitive.createToastManager;

export interface ToasterProps extends ToastPrimitive.Provider.Props {
  /**
   * Where to portal the toast viewport. Defaults to <body>. Pass a themed
   * container when the theme is scoped to a subtree (data-theme on a
   * container that isn't at document root) so toasts inherit its tokens
   * and font.
   */
  container?: ToastPrimitive.Portal.Props['container'];
}

/**
 * Mount once, wrapping the app (or at least any subtree that calls
 * `useToastManager`) — pass the app as `children`. The toast list itself
 * portals to `<body>` (or `container`) regardless of where `Toaster` sits
 * in the tree, so wrapping vs. mounting as a leaf near the root both work
 * for the common case of firing toasts via the `toast` manager above.
 *
 * Defaults `toastManager` to this module's shared singleton — see `toast`.
 */
export function Toaster({ container, children, toastManager = toast, ...props }: ToasterProps) {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} {...props}>
      {children}
      <ToastPrimitive.Portal container={container}>
        <ToastPrimitive.Viewport className={styles.viewport}>
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  );
}
