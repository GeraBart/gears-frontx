import { cx } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import styles from './table.module.css';

/*
 * Table has no Base UI primitive (registry/base-vega ships plain native
 * elements with data-slot markers, this kit drops data-slot everywhere —
 * see card.tsx) — pure styling translation over native `<table>` markup,
 * per design-notes.md: a composite data-table (sorting, filtering,
 * pagination, virtualisation, column defs) is deliberately out of scope
 * here. This is styled markup, nothing more.
 *
 * Table renders two elements, matching the source exactly: its own
 * horizontal-scroll wrapper div around the <table>, rather than asking
 * every consumer to remember to add one. A consumer who also wants a
 * *vertical* scroll region (e.g. capping a long table's height) wraps
 * their own div with `overflow-y` around <Table> — it composes fine, since
 * the two wrappers scroll orthogonal axes (see table.md).
 *
 * That wrapper is `tabIndex={0}`, a deliberate addition over the source,
 * which has none. A horizontally-overflowing region with no scrollbar
 * dragging alternative is otherwise unreachable from the keyboard (WCAG
 * 2.1.1) — a mouse/touch user can drag or swipe it, a keyboard-only user
 * cannot Tab to it and press the arrow keys, since a plain `div` isn't in
 * the tab order by default. This is unconditional rather than toggled on
 * only when the table actually overflows: detecting that needs a
 * ResizeObserver, which is exactly the behavior layer this "primitive
 * markup" component intentionally does not have. The trade-off is a table
 * that never overflows still gets one extra, functionless tab stop — minor
 * next to the alternative of a table that does overflow being silently
 * unreachable.
 *
 * A focus stop should announce something: `label` names the wrapper
 * (`role="region"` + `aria-label` — a bare div's aria-label is ignored
 * without a role, which is also why wrapping the Table yourself and
 * labelling that wrapper doesn't work: the name lands on a non-focusable
 * element while the focusable one stays nameless). Without `label` the
 * wrapper stays roleless and nameless as before — prefer passing it
 * whenever the surrounding page doesn't already make the table's purpose
 * obvious the moment focus lands.
 */
export interface TableProps extends ComponentProps<'table'> {
  /**
   * Accessible name for the focusable scroll wrapper around the table
   * (`role="region"` + `aria-label`). Announced when keyboard focus lands
   * on the wrapper; without it the stop announces nothing.
   */
  label?: string;
}

export function Table({ className, label, ...props }: TableProps) {
  return (
    <div
      className={styles.tableContainer}
      tabIndex={0}
      role={label === undefined ? undefined : 'region'}
      aria-label={label}
    >
      <table className={cx(styles.table, className)} {...props} />
    </div>
  );
}

export type TableHeaderProps = ComponentProps<'thead'>;

export function TableHeader({ className, ...props }: TableHeaderProps) {
  return <thead className={cx(styles.tableHeader, className)} {...props} />;
}

export type TableBodyProps = ComponentProps<'tbody'>;

export function TableBody({ className, ...props }: TableBodyProps) {
  return <tbody className={cx(styles.tableBody, className)} {...props} />;
}

export type TableFooterProps = ComponentProps<'tfoot'>;

export function TableFooter({ className, ...props }: TableFooterProps) {
  return <tfoot className={cx(styles.tableFooter, className)} {...props} />;
}

export type TableRowProps = ComponentProps<'tr'>;

export function TableRow({ className, ...props }: TableRowProps) {
  return <tr className={cx(styles.tableRow, className)} {...props} />;
}

export type TableHeadProps = ComponentProps<'th'>;

export function TableHead({ className, ...props }: TableHeadProps) {
  return <th className={cx(styles.tableHead, className)} {...props} />;
}

export type TableCellProps = ComponentProps<'td'>;

export function TableCell({ className, ...props }: TableCellProps) {
  return <td className={cx(styles.tableCell, className)} {...props} />;
}

/**
 * A table's accessible name/description, kept as a real semantic caption
 * regardless of where it's drawn — `.table`'s `caption-side: bottom` (see
 * table.module.css) only moves it visually below the rows; a `<caption>`
 * contributes to the table's accessibility tree the same way at either
 * position.
 */
export type TableCaptionProps = ComponentProps<'caption'>;

export function TableCaption({ className, ...props }: TableCaptionProps) {
  return <caption className={cx(styles.tableCaption, className)} {...props} />;
}
