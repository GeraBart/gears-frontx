# Badge

A small pill-shaped label for a status, count, or category tag. Badge has no
Base UI primitive — it's a styled `span`, plus a `render` prop (via Base
UI's `useRender`/`mergeProps` utilities, the same building blocks Base UI's
own primitives use) for the one case that needs it: rendering as a link.

## When to use

- A status label attached to an entity in a list or a page header (`Active`,
  `Draft`, `Failed`) — `default`, `secondary`, `destructive`, or `outline`.
- A small count or category tag (`3 new`, `Beta`).
- A label that should recede into the surrounding surface until it's
  actually interactive — `ghost` has no fill or border at rest, only a
  `--muted` background on hover.
- A tag that should give the impression of inline text rather than a pill
  — `link` has no fill or border at all, just `--primary`-colored text
  that underlines on hover. It still keeps Badge's fixed height and
  padding and won't wrap (see "When not to use"), so it reads like a link
  without actually flowing as one.
- A clickable tag or filter chip — pass `render={<a href="..." />}`. For
  `default`/`secondary`/`destructive`/`outline`, hover feedback (a
  background/text shift) only appears once the badge is actually rendered
  as a link this way; a plain (non-`render`) instance of those four stays
  visually inert, so it never looks clickable when it isn't. `ghost` and
  `link` are the opposite — both hover unconditionally, `render` or not
  (matching the source registry), so their hover style is never a signal
  of clickability on its own.

  When you do use `render` to make a badge clickable: the anchor joins the
  page's normal tab order (Badge adds no `tabIndex` or focus trap of its
  own), so place it where a keyboard user would expect a link, not buried
  where tabbing to it is surprising. Give it discernible text — its own
  children, or an `aria-label`/`title` on the anchor if the visible content
  is an icon alone — since a badge with no accessible name is unusable via
  keyboard or screen reader even though it's technically focusable. The
  kit's own focus ring (`--ring`, or the destructive-tinted one for
  `variant="destructive"`) appears automatically once the anchor receives
  keyboard focus — no extra prop needed.

## When not to use

- A clickable action with its own visual weight — use `button` (`variant="outline"`
  or `variant="secondary"` there reads as a real button, not a tag).
- Long or wrapping text — Badge is single-line (`white-space: nowrap`) and
  clips overflow; use plain text or `card` for anything longer than a
  short label.

## Props (kit level)

| Prop | Type | Default |
|------|------|---------|
| `variant` | `default` \| `secondary` \| `destructive` \| `outline` \| `ghost` \| `link` | `default` |
| `render` | `ReactElement` — replaces the root `span`, e.g. with an `<a>` | — |
| `className` | `string` — merged after the variant class | — |

All other props are native `<span>` props (or the target element's props
when using `render`) and are forwarded as-is, including `aria-invalid`
(shows a destructive-tinted border and ring, independent of `variant`).

## Examples

```tsx
import { Badge } from '@gears-frontx/ui-kit';

// Status labels
<Badge>Active</Badge>
<Badge variant="secondary">Draft</Badge>
<Badge variant="destructive">Failed</Badge>
<Badge variant="outline">Beta</Badge>

// ghost: recedes into the surface until interactive
<Badge variant="ghost">Unread</Badge>

// link: reads as inline text, not a pill
<Badge variant="link">See changelog</Badge>

// A badge that is actually a link — hover feedback only applies here
<Badge variant="outline" render={<a href="/filters/open" />}>
  3 open
</Badge>
```

## Anti-patterns

- Do not expect hover feedback from a plain (non-`render`) `default`,
  `secondary`, `destructive`, or `outline` badge — those four stay visually
  inert unless actually rendered as a link via `render`, matching the
  source registry. Conversely, don't read `ghost` or `link` hovering as a
  sign they're clickable — both hover the same way whether or not `render`
  is set.
- Do not nest interactive controls (buttons, links other than the one
  supplied via `render`) inside a Badge — it is a label, not a container.
- Do not restyle via inline `style` — brand changes belong in theme tokens.
