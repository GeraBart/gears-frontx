import { useEffect, useState } from 'react';

import { Separator } from '@gears-frontx/ui-kit';

import { Row, Section } from './shared';

const COLOR_GROUPS: { title: string; tokens: string[] }[] = [
  {
    title: 'Surfaces',
    tokens: [
      'background',
      'surface',
      'surface-elevated',
      'card',
      'card-hover',
      'popover',
      'overlay',
      'sidebar',
      'sidebar-accent',
      'code-background',
    ],
  },
  {
    title: 'Text',
    tokens: [
      'foreground',
      'muted-foreground',
      'subtle-foreground',
      'card-foreground',
      'popover-foreground',
      'primary-foreground',
      'secondary-foreground',
      'accent-foreground',
      'destructive-foreground',
      'sidebar-foreground',
      'sidebar-accent-foreground',
      'code-foreground',
    ],
  },
  {
    title: 'Brand & interactive',
    tokens: ['primary', 'primary-hover', 'secondary', 'accent', 'muted', 'ring', 'blue'],
  },
  {
    title: 'Status',
    tokens: [
      'success',
      'success-soft',
      'warning',
      'warning-soft',
      'danger',
      'danger-soft',
      'info',
      'info-soft',
      'destructive',
    ],
  },
  {
    title: 'Borders',
    tokens: ['border', 'border-strong', 'input', 'sidebar-border'],
  },
];

const RADII = ['', '-xs', '-sm', '-md', '-lg', '-xl'];
const SPACES = ['1', '2', '3', '4', '5', '6', '8'];
const CONTROL_HEIGHTS = ['sm', 'md', 'lg'];
const ICON_SIZES = ['sm', 'md', 'lg'];
const BORDER_WIDTHS = ['border-width', 'border-width-focus'];

const ALL_TOKENS = [
  ...COLOR_GROUPS.flatMap((group) => group.tokens),
  ...RADII.map((step) => `radius${step}`),
  ...SPACES.map((step) => `space-${step}`),
  ...CONTROL_HEIGHTS.map((step) => `control-height-${step}`),
  ...ICON_SIZES.map((step) => `icon-size-${step}`),
  ...BORDER_WIDTHS,
];

/**
 * Resolved values straight from the cascade. Re-read on `data-theme`
 * changes (watched directly — a `theme` prop would race the parent
 * effect that applies the attribute, since child effects fire first)
 * and on OS scheme flips (the `auto` case).
 */
function useTokenValues(): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const read = () => {
      const styles = getComputedStyle(document.documentElement);
      const next: Record<string, string> = {};
      for (const token of ALL_TOKENS) {
        next[token] = styles.getPropertyValue(`--${token}`).trim();
      }
      setValues(next);
    };
    read();
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      scheme.removeEventListener('change', read);
      observer.disconnect();
    };
  }, []);
  return values;
}

function Swatch({ token, value }: { token: string; value?: string }) {
  return (
    <div style={{ width: 148, fontSize: 11, display: 'grid', gap: 2 }}>
      <div
        style={{
          height: 44,
          borderRadius: 'var(--radius-sm)',
          background: `var(--${token})`,
          border: 'var(--border-width) solid var(--border-strong)',
        }}
      />
      <code>--{token}</code>
      <code style={{ color: 'var(--muted-foreground)' }}>{value}</code>
    </div>
  );
}

export function TokensPage() {
  const values = useTokenValues();
  return (
    <>
      {COLOR_GROUPS.map((group) => (
        <Section key={group.title} title={group.title}>
          <Row style={{ alignItems: 'start' }}>
            {group.tokens.map((token) => (
              <Swatch key={token} token={token} value={values[token]} />
            ))}
          </Row>
        </Section>
      ))}

      <Section title="Radius">
        <Row>
          {RADII.map((step) => (
            <div key={step} style={{ textAlign: 'center', fontSize: 11, display: 'grid', gap: 2 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: `var(--radius${step})`,
                  border: 'var(--border-width) solid var(--border-strong)',
                  background: 'var(--card)',
                }}
              />
              <code>--radius{step}</code>
              <code style={{ color: 'var(--muted-foreground)' }}>{values[`radius${step}`]}</code>
            </div>
          ))}
        </Row>
      </Section>

      <Section title="Spacing">
        <Row style={{ alignItems: 'end' }}>
          {SPACES.map((step) => (
            <div key={step} style={{ textAlign: 'center', fontSize: 11, display: 'grid', gap: 2 }}>
              <div
                style={{
                  width: `var(--space-${step})`,
                  height: 40,
                  margin: '0 auto',
                  background: 'var(--primary)',
                  borderRadius: 'var(--radius-xs)',
                }}
              />
              <code>--space-{step}</code>
              <code style={{ color: 'var(--muted-foreground)' }}>{values[`space-${step}`]}</code>
            </div>
          ))}
        </Row>
      </Section>

      <Section title="Controls scale">
        <Row style={{ alignItems: 'end' }}>
          {CONTROL_HEIGHTS.map((step) => (
            <div key={step} style={{ textAlign: 'center', fontSize: 11, display: 'grid', gap: 2 }}>
              <div
                style={{
                  width: 88,
                  height: `var(--control-height-${step})`,
                  borderRadius: 'var(--radius-md)',
                  border: 'var(--border-width) solid var(--border-strong)',
                  background: 'var(--surface-elevated)',
                }}
              />
              <code>--control-height-{step}</code>
              <code style={{ color: 'var(--muted-foreground)' }}>
                {values[`control-height-${step}`]}
              </code>
            </div>
          ))}
          <Separator orientation="vertical" style={{ height: 56 }} aria-hidden="true" />
          {ICON_SIZES.map((step) => (
            <div key={step} style={{ textAlign: 'center', fontSize: 11, display: 'grid', gap: 2 }}>
              <div
                style={{
                  width: `var(--icon-size-${step})`,
                  height: `var(--icon-size-${step})`,
                  margin: '0 auto',
                  borderRadius: 'var(--radius-xs)',
                  background: 'var(--muted-foreground)',
                }}
              />
              <code>--icon-size-{step}</code>
              <code style={{ color: 'var(--muted-foreground)' }}>{values[`icon-size-${step}`]}</code>
            </div>
          ))}
          <Separator orientation="vertical" style={{ height: 56 }} aria-hidden="true" />
          {BORDER_WIDTHS.map((token) => (
            <div key={token} style={{ textAlign: 'center', fontSize: 11, display: 'grid', gap: 2 }}>
              <div
                style={{
                  width: 88,
                  height: `var(--${token})`,
                  margin: '0 auto',
                  background: 'var(--foreground)',
                }}
              />
              <code>--{token}</code>
              <code style={{ color: 'var(--muted-foreground)' }}>{values[token]}</code>
            </div>
          ))}
        </Row>
      </Section>
    </>
  );
}
