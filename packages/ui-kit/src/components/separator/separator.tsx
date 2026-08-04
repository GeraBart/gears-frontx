import { Separator as SeparatorPrimitive } from '@base-ui/react/separator';
import { cx } from 'class-variance-authority';

import styles from './separator.module.css';

/*
 * base-vega's own Separator is a thin wrapper: orientation defaults to
 * 'horizontal' and every other prop passes through untouched — no variant
 * logic, hence no cva here (unlike Badge/Tabs). It also renders
 * `data-slot="separator"` (base-vega's own devtools/testing-hook
 * convention); this kit drops `data-slot` everywhere (see card.tsx), so
 * its absence here is that same standing decision, not an oversight.
 *
 * Unlike Radix's Separator, Base UI's has no `decorative` boolean. Its
 * source (node_modules/@base-ui/react/separator/Separator.js) always sets
 * `role="separator"` and `aria-orientation` from its internal props object,
 * merged *before* the consumer's own `elementProps`. Base UI's `mergeProps`
 * is rightmost-wins for plain attributes (see merge-props/mergeProps.js),
 * and `elementProps` is the rightmost entry in that merge — so a consumer
 * who passes `aria-hidden="true"` directly gets that value on the DOM node
 * instead. That's the documented way to get a purely decorative divider:
 * per WAI-ARIA, `role="separator"` announces a structural landmark, which
 * is wrong for a divider that conveys no structure of its own.
 * `role="none"` alone is NOT an equivalent opt-out: `aria-orientation`
 * stays set regardless of `role` (Base UI applies it unconditionally,
 * independently of the role override), and `aria-orientation` on a role
 * that doesn't permit it is an `aria-allowed-attr` violation —
 * `aria-hidden="true"` sidesteps this entirely by removing the element
 * from the accessibility tree, role and all. base-vega doesn't add a
 * `decorative` prop either, so this kit doesn't invent one — see
 * separator.md for the worked example. Note decorative is likely the more
 * common real-world case (shadcn's own Radix-based styles default their
 * wrapper's `decorative` to `true`); base-vega's own wrapper is
 * semantic-by-default only because Base UI has nothing else to default
 * to, and this kit stays faithful to that rather than restoring Radix's
 * default via its own logic.
 *
 * DropdownMenuSeparator (dropdown-menu.tsx) and SelectSeparator
 * (select.tsx) already wrap this exact same Base UI primitive
 * (@base-ui/react/menu and @base-ui/react/select both re-export it
 * verbatim — see menu/index.parts.d.ts and select/index.parts.d.ts) but
 * keep their own styling, and deliberately stay that way here too:
 * base-vega itself styles all three as independent registry items with
 * different classes (`-mx-1 my-1 h-px bg-border`, bleeding into the
 * popup's padding, vs. this component's `shrink-0` full-bleed divider with
 * no margin management) — the shared primitive is an implementation detail
 * of three separate visual roles, not a cue to unify them.
 */
export interface SeparatorProps extends Omit<SeparatorPrimitive.Props, 'className'> {
  className?: string;
}

export function Separator({ className, ...props }: SeparatorProps) {
  return <SeparatorPrimitive className={cx(styles.separator, className)} {...props} />;
}
