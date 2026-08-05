# Skeleton

A pulsing placeholder shape shown while real content is loading. Skeleton
has no Base UI primitive — it's a styled `div` with no variants; you size
and shape it yourself via `className`.

## When to use

- In place of text, an avatar, an image, or a card while its data is still
  loading — size it to roughly match what it stands in for (a line of
  text, a circular avatar, a thumbnail) so the layout doesn't jump once the
  real content arrives.
- Composed into a larger loading layout — several Skeletons stacked or
  arranged like the content they're standing in for.

## When not to use

- For a single inline spinner or button-busy state — that's a spinner
  icon, not a placeholder shape (the kit has no standalone spinner
  component to reach for yet; `Toast`'s loading icon is internal to that
  component, not exported).
- As a permanent empty state — Skeleton communicates "loading now", not
  "nothing here"; use real empty-state content for the latter.

## Reduced motion

Skeleton pulses via a CSS `animation` (opacity 1 → 0.5 → 1, looping). Under
`prefers-reduced-motion: reduce` the kit turns the animation off entirely
and leaves the shape at full opacity — this is a deliberate deviation from
the shadcn source, whose Tailwind `animate-pulse` utility has no
reduced-motion handling of its own. The placeholder stays visible either
way; only the continuous motion is removed for users who have asked their
OS to minimize it.

## Accessibility

Skeleton itself carries no ARIA — matching the shadcn source, which adds
none either, and Base UI, which has no primitive here to default one from.
Loading semantics belong on the container around your Skeletons, not on
each one individually — but getting that container right takes three
pieces together, not just `role="status"` alone:

- **`role="status"`** on the container (it already implies
  `aria-live="polite"` — don't also wrap it in a separate `aria-live`
  region; that's redundant and can double-announce the same change).
- **Visually-hidden text inside that container**, not an `aria-label` on
  it — a live region only announces *changes to its content*, and an
  `aria-label` is the region's accessible name, not content; it doesn't
  change and isn't the announced payload. A `role="status"` div holding
  nothing but Skeleton placeholders and no text has nothing to announce at
  load time no matter what other attributes it carries (see Examples).
- **`aria-busy` that actually transitions**, `true` while loading and
  `false` once the real content replaces the placeholders. Per WAI-ARIA,
  `aria-busy="true"` tells assistive tech to hold off announcing changes
  inside the region *while it is true* — it does not itself produce an
  announcement, and hardcoding it permanently to `true` means the
  completion is never announced, the opposite of the intended effect. The
  announcement fires on the `true` → `false` transition, so the value has
  to track your real loading state (see Examples).

If a particular Skeleton instance is purely decorative filler inside
content that's already announced some other way, pass `aria-hidden="true"`
directly to that instance; it forwards like any other native `div` prop.

## Props (kit level)

| Prop | Type | Default |
|------|------|---------|
| `className` | `string` — merged after the kit class | — |

All other props are native `<div>` props and are forwarded as-is,
including `aria-hidden` for the decorative case above.

## Examples

```tsx
import { Skeleton } from '@gears-frontx/ui-kit';

// A line of text
<Skeleton style={{ height: '1rem', width: '250px' }} />

// A circular avatar placeholder
<Skeleton style={{ height: '3rem', width: '3rem', borderRadius: '9999px' }} />
```

```tsx
import { useState } from 'react';
import { Skeleton } from '@gears-frontx/ui-kit';

// A loading card: the container carries the loading semantics, not each
// shape. `aria-busy` tracks real state and flips to false once `loading`
// does — a hardcoded `aria-busy="true"` would never announce completion.
function LoadingCard() {
  const [loading, setLoading] = useState(true);
  // ...fetch real data, then setLoading(false) when it arrives.

  return (
    <div role="status" aria-busy={loading}>
      {/* Visually hidden, inlined: matches the kit's own .srOnly recipe
          (dialog.module.css), which is module-local to Dialog and not
          exported for reuse here. */}
      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
          whiteSpace: 'nowrap',
          border: 0,
          margin: -1,
        }}
      >
        {loading ? 'Loading…' : 'Loaded'}
      </span>
      {loading && (
        <>
          <Skeleton style={{ height: '12rem', width: '100%' }} />
          <Skeleton style={{ height: '1rem', width: '75%', marginTop: '0.5rem' }} />
          <Skeleton style={{ height: '1rem', width: '50%', marginTop: '0.25rem' }} />
        </>
      )}
    </div>
  );
}
```

## Anti-patterns

- Do not rely on Skeleton itself to announce loading state to assistive
  tech — it has no ARIA of its own; put `role="status"`, accessible text,
  and a real `aria-busy` on the container instead (see Accessibility
  above).
- Do not hardcode `aria-busy="true"` on that container — a value that
  never becomes `false` means the loading-complete announcement never
  fires. Bind it to your actual loading state.
- Do not pair `role="status"` with a separate `aria-live` wrapper —
  `role="status"` already implies `aria-live="polite"`; the two together
  risk a duplicated announcement.
- Do not restyle via the kit's class names — brand changes belong in theme
  tokens (`--muted`, `--radius-md` here); size/shape are the one thing you
  do set per instance, via `className` or inline `style`.
