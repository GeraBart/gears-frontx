# @gears-frontx/ui-kit

Standard React component base for FrontX templates. Templates build their
screens from it and receive fixes and design updates via a dependency bump;
templates may mix in other components, and other companies can plug their own
kits into their own templates.

- **Stack:** React 19 + Base UI + CSS Modules + CVA
- **Self-contained styles:** the package ships compiled CSS — consumers need no
  CSS framework, preprocessor, or build plugins
- **Customization:** basic branding via CSS-variable tokens; deep changes = fork

## Usage

```ts
// once, in the consumer entry module
import '@gears-frontx/ui-kit/theme.css'; // design tokens (CSS variables)
import '@gears-frontx/ui-kit/styles.css'; // compiled component styles
```

```tsx
import { Button } from '@gears-frontx/ui-kit';

<Button variant="outline" size="sm">
  Save
</Button>;
```

The theme file paints the page (background, text, and UA-owned surfaces like
the scrollbar) as well as defining the tokens, so dark mode works out of the
box with no attribute at all: it follows `prefers-color-scheme` by default.
For explicit control instead, set `data-theme="dark"` or `data-theme="light"`
on `<html>` — or on any inner subtree, which then paints its own surface
independently of the page around it.

To re-brand, override the CSS variables from `theme.css` in your own styles.

## Development

```bash
npm run build --workspace=@gears-frontx/ui-kit   # tsup: dist/index.{js,cjs,d.ts,css} + theme.css
npm run test:unit --workspace=@gears-frontx/ui-kit
./packages/ui-kit/scripts/verify-consumer.sh     # pack-install acceptance check
```

See [design-notes.md](design-notes.md) for the design and its history. The package is
`private` until the MVP component set lands and #495 approves its architecture
ownership, traceability, and version policy. The required CDSL artifacts must
also replace the temporary `artifacts.toml` ignore. Only then may `private` be
removed for publication through the standard version-gated workflow.
