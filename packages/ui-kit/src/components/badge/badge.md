# Badge

A status label: a colored dot plus an intent-colored caption, as a soft
pill or a bare dot+label pair. Badge has no Base UI primitive — it's a
styled `span`, plus a `render` prop (via Base UI's `useRender`/`mergeProps`
utilities) for the one case that needs it: rendering as a link.

Badge speaks **semantic intent only** (per the Studio design): you say what
kind of state you're marking (`success`, `warning`, `info`, `danger`,
`muted`), never how to paint it. The prop is the kit-wide `variant` — like
every other component — but its values are states, not paint jobs: there is
no `primary`/`outline`/`ghost` here, and picking `warning` because you want
orange is a misuse, not a style choice.

## When to use

- A status attached to an entity in a list, table cell, or page header:
  `running` → `success`, `failed` → `danger`, `pending` → `warning`,
  `beta`/`new` → `info`, anything neutral (`draft`, `archived`, a count,
  a category) → `muted`.
- `shape="pill"` (default) on busy surfaces where the label needs its own
  soft fill; `shape="dot"` inline with text or in dense tables where a fill
  would be noise — same dot and label, no pill behind them.
- A clickable status filter — pass `render={<a href="..." />}`. The pill's
  fill deepens on hover and the dot shape underlines, but only when actually
  rendered as a link; a plain badge stays visually inert and never looks
  clickable when it isn't. The kit's focus ring appears automatically once
  the anchor receives keyboard focus. Give it discernible text — a badge
  with no accessible name is unusable via keyboard or screen reader.

## When not to use

- A clickable action with its own visual weight — use `button`.
- Long or wrapping text — Badge is single-line (`white-space: nowrap`) and
  clips overflow.
- Prose-colored emphasis or arbitrary brand colors — intents are the whole
  vocabulary; recoloring a badge via CSS breaks the semantic contract.

## Props (kit level)

| Prop | Type | Default |
|------|------|---------|
| `variant` | `success` \| `warning` \| `info` \| `danger` \| `muted` | `muted` |
| `shape` | `pill` \| `dot` | `pill` |
| `render` | `ReactElement` — replaces the root `span`, e.g. with an `<a>` | — |
| `className` | `string` — merged after the variant/shape classes | — |

All other props are native `<span>` props (or the target element's props
when using `render`) and are forwarded as-is, including `aria-invalid`
(shows a destructive-tinted border and ring, independent of `variant`).

## Examples

```tsx
import { Badge } from '@gears-frontx/ui-kit';

// Status labels (pill is the default shape)
<Badge variant="success">Running</Badge>
<Badge variant="danger">Failed</Badge>
<Badge variant="warning">Degraded</Badge>
<Badge variant="info">Beta</Badge>
<Badge>Draft</Badge>  // muted is the default variant

// Bare dot+label for dense/inline placements
<Badge variant="success" shape="dot">Online</Badge>

// A badge that is actually a link — hover feedback only applies here
<Badge variant="info" render={<a href="/filters/open" />}>
  3 open
</Badge>
```

## Anti-patterns

- Do not pick a variant for its color ("warning looks nice and orange") —
  intents are semantics; if no state maps, use `muted`.
- Do not recolor a badge via `className`/`style` — the intent palette and
  its contrast math live in the kit; brand changes belong in theme tokens.
- Do not expect hover feedback from a plain (non-`render`) badge — it only
  appears when the badge actually renders as a link via `render`.
- Do not nest interactive controls inside a Badge — it is a label, not a
  container.
