# Button

An action button. Wraps the Base UI Button primitive: render-prop
polymorphism, correct disabled/focus behavior, `type="button"` by default
(pass `type="submit"` explicitly for form submission).

## When to use

- Any click-triggered action: submit, delete, open a dialog, toggle a panel.
- An action that also navigates (e.g. "Open reports"):
  `<Button render={<a href="..." />} nativeButton={false}>`. It is announced
  as a button (`role="button"`), while the real anchor underneath keeps
  cmd-click/middle-click and crawlability. Not a substitute for a link: for
  plain navigation use the consumer app's link component.

## When not to use

- Plain in-text navigation — use the consumer app's link component, not
  `variant="link"`; that variant exists for actions that visually read as
  links.
- Toggling on/off state — use `switch` or `checkbox` instead.

## Props (kit level)

| Prop | Type | Default |
|------|------|---------|
| `variant` | `default` \| `destructive` \| `outline` \| `secondary` \| `ghost` \| `link` | `default` |
| `size` | `default` \| `sm` \| `lg` (the F-mockups' md/sm/lg scale; `default` is md) | `default` |
| `icon` | `ReactNode` — leading icon slot, marked decorative (`aria-hidden`); the ONLY right place for a button icon | — |
| `loading` | `boolean` — centered spinner, disables the button, sets `aria-busy`; content keeps its space and the button keeps its accessible name | `false` |
| `render` | `ReactElement` — replaces the root element, button semantics are applied to it | — |
| `nativeButton` | `boolean` — set to `false` whenever `render` is not a native `<button>` | `true` |
| `focusableWhenDisabled` | `boolean` — keep the button in tab order when disabled | `false` |
| `className` | `string` — merged after variant classes | — |

All other props are native `<button>` props (`onClick`, `disabled`, `type`,
`aria-*`, ...) and are forwarded as-is.

Icon-only is derived, not a size: `icon` with no children renders a square
button of the current `size`. There is no `size="icon"`.

## Examples

```tsx
import { Button } from '@gears-frontx/ui-kit';

// Primary action
<Button onClick={save}>Save</Button>

// Dangerous action
<Button variant="destructive" onClick={remove}>Delete</Button>

// Secondary action next to a primary one
<Button variant="outline" onClick={cancel}>Cancel</Button>

// Icon next to the label goes in the icon slot, never in children
<Button icon={<PlusIcon />} onClick={create}>New project</Button>

// Icon-only (icon slot + no children): always label it
<Button icon={<CrossIcon />} aria-label="Close" />

// Async action: loading disables and spins, width does not jump
<Button loading={saving} onClick={save}>Save</Button>

// Button-semantic action over a real anchor (announced as a button,
// cmd-clickable) — not for plain navigation
<Button render={<a href="/reports" />} nativeButton={false} variant="outline">
  Open reports
</Button>

// Form submit (explicit type)
<Button type="submit">Create account</Button>
```

## Anti-patterns

- Do not restyle via inline `style` or ad-hoc CSS — brand changes belong in
  the theme tokens (`theme.css` CSS variables). If you rebrand the focus
  ring specifically via `--button-focus-ring`, note that the `default` and
  `destructive` variants also set an explicit `--button-focus-ring-inner`
  of their own (a two-tone ring, needed to clear WCAG contrast against
  their own fill) — overriding only `--button-focus-ring` on those two
  leaves the old inner color in place instead of following it; set both
  properties together when rebranding either variant's ring.
- Do not put an icon in `children` next to text — it lands in the `icon`
  slot, which is what sizes it, spaces it, hides it during `loading`, and
  keeps it out of the accessible name.
- Do not render an icon-only button (icon slot, no children) without
  `aria-label` — the icon is decorative and carries no name.
- Do not emulate `loading` by swapping children for a spinner — the button
  loses its accessible name and jumps in width; pass `loading`.
- Do not emulate disabled with CSS/`onClick` guards — pass `disabled`
  (add `focusableWhenDisabled` if it must stay discoverable by keyboard).
