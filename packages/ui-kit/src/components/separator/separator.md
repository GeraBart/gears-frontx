# Separator

A thin visual divider between sections of content. A styled Base UI
`Separator` (`@base-ui/react/separator`) — no variants, just an
`orientation` prop.

## When to use

- Between stacked sections of a page or panel (a horizontal rule).
- Between items in a horizontal toolbar or button group (a vertical rule)
  — the kit's `.separator` class carries `flex-shrink: 0` so it never gets
  squeezed to nothing in a tight flex row.

## When not to use

- Inside a `DropdownMenu` or `Select` popup — use `DropdownMenuSeparator`
  / `SelectSeparator` instead. Both already wrap this exact same Base UI
  primitive (Menu and Select re-export `Separator` verbatim), but keep
  their own styling scoped to a popup's list (a bleed margin into the
  popup's padding), which this component does not apply. They are not
  aliases of each other — pick the one that matches where the divider
  lives.
- As a layout spacer — Separator renders a visible 1px line; use CSS gap
  or margin for invisible spacing.

## Orientation

- `orientation="horizontal"` (default): full width, 1px tall.
- `orientation="vertical"`: 1px wide, `align-self: stretch` to fill the
  parent's cross-axis height. `align-self` overrides whatever the flex
  parent's own `align-items` is set to (that's its purpose), so a vertical
  Separator stretches to the flex line's height even inside a row with
  `align-items: center` — that combination works. It collapses to 0px
  tall in the two cases where there is no flex-line height to stretch
  into: a non-flex (plain block) parent, where `align-self` has no effect
  at all — no explicit height on that parent fixes this, since there's no
  flex context for `align-self` to act in; make the parent `display: flex`
  (or give the Separator its own height directly) — or a flex row whose
  other items are themselves all zero-height, where giving the row a real
  height is the fix.

Base UI stamps both `data-orientation` and `aria-orientation` from this
prop; the kit's CSS reads `data-orientation` to switch dimensions.

## Decorative vs. semantic separators

Base UI's `Separator` always renders `role="separator"` with a matching
`aria-orientation` — there is no `decorative` boolean the way Radix's
Separator has one. Per WAI-ARIA, `role="separator"` announces a
structural landmark to assistive tech, which is the right default for a
divider that actually delineates distinct sections (e.g. between two
groups of settings). It is the wrong choice for a divider that is purely
visual and carries no structure of its own (e.g. a hairline between a
toolbar's icon buttons) — there, override the default by passing
`aria-hidden="true"` directly (see "Decorative divider" under Examples).
Decorative is likely the more common case in practice: shadcn's own
Radix-based styles default their Separator wrapper's `decorative` prop to
`true`. base-vega's wrapper (and this kit) default to semantic instead
only because Base UI has no `decorative` prop to default — not because
decorative dividers are the exception.

The override works because Base UI's own `role`/`aria-orientation`
defaults are merged before the consumer's props, and the consumer's props
win on conflict — passing `aria-hidden` through to a `Separator` always
reaches the DOM. Use `aria-hidden="true"` alone, not `role="none"`: Base
UI sets `aria-orientation` unconditionally, independent of any `role`
override, and `aria-orientation` on a role that doesn't permit it (such
as `none`) is an `aria-allowed-attr` violation. `aria-hidden="true"`
removes the element from the accessibility tree entirely, so the role it
carries underneath stops mattering.

## Props (kit level)

| Prop | Type | Default |
|------|------|---------|
| `orientation` | `horizontal` \| `vertical` | `horizontal` |
| `className` | `string` — merged after the kit class | — |

All other props are native `<div>` props and are forwarded as-is,
including `aria-hidden` for the decorative case above.

## Examples

```tsx
import { Separator } from '@gears-frontx/ui-kit';

// Between stacked sections
<div>
  <p>Account settings</p>
  <Separator />
  <p>Danger zone</p>
</div>

// Vertical, between toolbar items — the row needs a real height for
// align-self: stretch to fill (align-items: center works fine here too,
// align-self overrides it on the Separator itself)
<div style={{ display: 'flex', alignItems: 'center', height: '1.5rem', gap: '0.5rem' }}>
  <span>Bold</span>
  <Separator orientation="vertical" />
  <span>Italic</span>
</div>

// Decorative divider — purely visual, hidden from assistive tech
<Separator aria-hidden="true" />
```

## Anti-patterns

- Do not use inside `DropdownMenuContent` or `SelectContent` — use
  `DropdownMenuSeparator` / `SelectSeparator`, which are styled for a
  popup's list, not this component.
- Do not expect a vertical separator to show up in a plain block
  container, or in a flex row whose other items are themselves
  zero-height — `align-self: stretch` needs a flex/grid parent with a
  real cross-axis size to stretch into. `align-items: center` on the row
  is not the problem; `align-self` on the Separator overrides it either
  way.
- Do not restyle via inline `style` — brand changes belong in theme
  tokens (`--border` here).
