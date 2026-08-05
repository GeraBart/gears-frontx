# UI Kit Demo

A two-page browser sandbox wired to [`@gears-frontx/ui-kit`](..): the design tokens on one page,
every component on the other.

It consumes the package the way an external user would - the bare specifier `@gears-frontx/ui-kit`,
resolved through the package's `exports` to `dist/`, no reaching into `src/`, no path aliases. That
is what makes it a check rather than a demo: if the sandbox compiles and renders, the public API,
the emitted types and the shipped CSS are usable.

Nothing here is published. `files[]` in the package manifest is a whitelist (`dist`, `llms.txt`,
`README.md`, `LICENSE`, `NOTICE`), and the library build's entries all live under `src/`, so `demo/`
reaches neither the tarball nor the bundle.

## Run

From the repo root:

```sh
npm run demo:ui-kit
```

Or from the package directory:

```sh
npm run demo
```

Open the URL Vite prints (<http://localhost:5173> by default - nothing in the demo depends on the
port, so it is not pinned; pass `--port` to move it).

`predemo` builds the kit first, so a fresh clone works in one command. The sandbox consumes the
kit's `dist/`, not its source, so kit edits need `npm run build`, not just a save. A rebuild does
show up on a plain reload though: the workspace-linked package is exempt from Vite's dependency
pre-bundling, so there is no cached copy to go stale and no server restart needed.

## What the pages show

Navigation is two hash routes (`#/tokens`, `#/components`) - deep-linkable, back/forward-friendly,
no router dependency. The header switches pages and pins the theme: `auto` follows the OS scheme,
`light`/`dark` set `data-theme` on `<html>`.

| Page | Shows |
| --- | --- |
| `#/tokens` | Every `theme.css` token with its resolved value read from the live cascade - colors grouped by role (surfaces, text, brand, status, borders), the radius and spacing scales, and the controls scale (heights, icon sizes, border widths). Values re-read on `data-theme` changes and OS scheme flips, so the labels always state what the current theme computes. |
| `#/components` | A kitchen sink of every exported component across its variants, sizes and states - buttons including the `icon` slot and `loading`, form controls wired through `Field`, overlays and toasts, table row states and densities. |

The sandbox drives the kit directly, the way any React consumer would. Wiring it into a FrontX app
is a separate concern and lives in template territory, not here.

## Notes

- The tokens page is the quick way to eyeball a palette change: rebuild the kit, reload, and the
  swatch plus its printed value both update.
- Derived radius steps print their declared `calc()` rather than resolved pixels - a custom
  property has no computed value until it is applied somewhere; the square next to each label
  draws the real result.
- The demo has its own `tsconfig.json`; `type-check:demo` runs it, and the root
  `type-check:packages:ui-kit` includes it, so a kit API change that breaks the sandbox fails the
  regular type gate.
