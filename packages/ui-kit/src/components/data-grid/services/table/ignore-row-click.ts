/*
 * Marks a cell the row-click plugin must not treat as a row click. It lives in the core because
 * the cell renderer stamps it, and the core's entry must not import the row-click plugin to do
 * that (see `services/layout/layout-slot-ids.ts` for the same split).
 */
export const IGNORE_CLICK_ATTRIBUTE = 'data-grid-row-ignore-click';
