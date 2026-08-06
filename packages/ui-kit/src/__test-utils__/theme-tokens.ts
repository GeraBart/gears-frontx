import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { declarationMap, extractRules } from './css-rules';

/*
 * Resolves theme.css's light and dark token blocks into plain name->value
 * maps, shared by every test that needs a token's actual per-theme value
 * (tokens.test.ts's own theme-sync/contrast guards, button.test.tsx's
 * focus-ring contrast guard). Block identity is selector shape, not array
 * position, so reordering theme.css doesn't silently break a caller —
 * `lightBlock`'s finder must reject `:not(` so it doesn't also match the
 * prefers-color-scheme mirror block, whose selector also contains `:root`.
 */
export interface ThemeTokens {
  light: Map<string, string>;
  dark: Map<string, string>;
}

export function readThemeTokens(): ThemeTokens {
  const themeCssPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'styles',
    'theme.css',
  );
  const rules = extractRules(readFileSync(themeCssPath, 'utf8'));
  const lightBlock = rules.find(
    (rule) =>
      rule.selector.includes(':root') &&
      rule.selector.includes("[data-theme='light']") &&
      !rule.selector.includes(':not('),
  );
  const darkBlock = rules.find((rule) => rule.selector === "[data-theme='dark']");
  if (!lightBlock || !darkBlock) {
    throw new Error(
      "theme.css's token block selectors changed shape — update readThemeTokens's block finders",
    );
  }
  return { light: declarationMap(lightBlock.body), dark: declarationMap(darkBlock.body) };
}
