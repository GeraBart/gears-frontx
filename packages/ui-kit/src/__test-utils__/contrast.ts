/*
 * WCAG 2.x contrast-ratio math over literal hex colors — shared by every
 * test that verifies a theme token clears an AA/1.4.11 floor (Button's
 * focus-ring cases in button.test.tsx; link text and the table header in
 * tokens.test.ts). Deliberately understands only `#rrggbb` hex, which is
 * what theme.css writes and what those tests parse out of it — a token
 * aliased to `var(--other-token)` instead of a literal hex would fail to
 * parse here, and that's load-bearing, not a gap: it's what forces every
 * token this math checks to carry its OWN measured value (see
 * button.module.css's light --link-foreground, which duplicates
 * --primary-hover's hex rather than referencing it, for exactly this
 * reason) instead of silently inheriting whatever another token measures
 * to today.
 */

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  return [0, 2, 4].map((i) => Number.parseInt(clean.slice(i, i + 2), 16));
}

function srgbToLinear(channel: number) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r ?? 0) + 0.7152 * srgbToLinear(g ?? 0) + 0.0722 * srgbToLinear(b ?? 0);
}

// WCAG's own formula (relative luminance + 0.05, ratio of the lighter over
// the darker) — not an approximation of it.
export function contrastRatio(hexA: string, hexB: string) {
  const l1 = relativeLuminance(hexA) + 0.05;
  const l2 = relativeLuminance(hexB) + 0.05;
  return Math.max(l1, l2) / Math.min(l1, l2);
}
