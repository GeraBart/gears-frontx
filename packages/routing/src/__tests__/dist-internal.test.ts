import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTING_EXCLUDED_BUILDING_BLOCKS, ROUTING_RUNTIME_SURFACE, ROUTING_TYPE_ONLY_SURFACE } from './helpers.js';
import { buildFreshDts, cleanupBuiltDts } from './helpers/build-dts.js';
import { declaresRuntimeExport, declaresType } from './helpers/surface-check.js';

// `stripInternal` (`../../tsconfig.json`, the same
// config `tsup` reads to build this package's own published declarations)
// is what is supposed to keep an `@internal`-tagged export — `HistoryAdapter`
// and `AdapterLocation` (`./history/adapter.ts`) were the concrete case —
// out of `dist/index.d.ts`. Merely adding the tag does not guarantee that:
// a multi-file re-export chain carries no `@internal` tag of its own at any
// hop, so `stripInternal` (which only strips a declaration where the tag is
// itself written) leaves it untouched regardless of the flag being enabled.
//
// TypeScript's `stripInternal` also tests a declaration's
// *whole* leading comment range, not only a tag on the declaration itself —
// an `@internal`-tagged `@param` in `resolveNavigationHistory`'s own leading
// JSDoc silently drops the entire function
// (the package's sole public construction path) from `dist/index.d.ts`
// while the runtime `dist/index.js` still exports it — invisible to an
// absence-only assertion. `HistoryAdapter`/`AdapterLocation` are
// public types instead (they sit in that function's own signature), so
// this file also asserts their *presence*, and runs a real consumer
// type-check against the emitted declarations so a name TypeScript cannot
// resolve fails loudly here instead of at a real consumer's own build.
//
// This test runs the real build (`tsup`, not a bare `tsc` declaration emit —
// the rollup-dts bundling step is exactly where a re-export chain either
// does or does not survive) into a throwaway output directory once for the
// whole file, so it
// exercises today's `tsconfig.json` + `src/index.ts` combination rather than
// a possibly-stale committed `dist/`.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const tscBin = path.join(repoRoot, 'node_modules/.bin/tsc');

let dts: string;
let outDir: string;

beforeAll(() => {
  const built = buildFreshDts();
  dts = built.dts;
  outDir = built.outDir;
});

afterAll(() => {
  cleanupBuiltDts(outDir);
});

describe('published dist/index.d.ts strips @internal declarations', () => {
  it('carries no @internal tag', () => {
    expect(dts).not.toMatch(/@internal/);
  });

  it('does not declare or export the internal construction building blocks', () => {
    for (const name of ROUTING_EXCLUDED_BUILDING_BLOCKS) {
      expect(dts, `unexpected declaration of ${name}`).not.toMatch(
        new RegExp(`\\bdeclare\\s+function\\s+${name}\\b`),
      );
      expect(dts, `unexpected export of ${name}`).not.toMatch(new RegExp(`^export\\s*\\{[^}]*\\b${name}\\b`, 'm'));
    }
  });
});

describe('published dist/index.d.ts declares the full DESIGN §3.3 public surface', () => {
  it.each(ROUTING_RUNTIME_SURFACE)('exports %s', (name) => {
    expect(declaresRuntimeExport(dts, name), `${name} missing from the export list`).toBe(true);
  });

  it.each(ROUTING_TYPE_ONLY_SURFACE)('declares %s', (name) => {
    expect(declaresType(dts, name), `${name} missing from the emitted declarations`).toBe(true);
  });

  it('a consumer importing every surface name from the emitted d.ts type-checks cleanly', () => {
    const consumerDir = mkdtempSync(path.join(tmpdir(), 'routing-dist-consumer-'));
    try {
      const valueImports = ROUTING_RUNTIME_SURFACE.join(', ');
      const typeImports = ROUTING_TYPE_ONLY_SURFACE.map((name) => `type ${name}`).join(', ');
      writeFileSync(
        path.join(consumerDir, 'consumer.ts'),
        [
          `import { ${valueImports}, ${typeImports} } from '@gears-frontx/routing';`,
          '',
          `export const _values = { ${valueImports} };`,
          `export type _types = [${ROUTING_TYPE_ONLY_SURFACE.join(', ')}];`,
          '',
        ].join('\n'),
      );
      writeFileSync(
        path.join(consumerDir, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              strict: true,
              skipLibCheck: false,
              noEmit: true,
              baseUrl: consumerDir,
              paths: { '@gears-frontx/routing': [path.join(outDir, 'index.d.ts')] },
            },
            include: ['consumer.ts'],
          },
          null,
          2,
        ),
      );
      execFileSync(tscBin, ['-p', path.join(consumerDir, 'tsconfig.json')], { cwd: consumerDir, stdio: 'pipe' });
    } catch (error) {
      const stdout =
        error !== null && typeof error === 'object' && 'stdout' in error
          ? String((error as { stdout?: Buffer | string }).stdout ?? '')
          : '';
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`consumer type-check failed: ${message}\n${stdout}`, { cause: error });
    } finally {
      rmSync(consumerDir, { recursive: true, force: true });
    }
  });
});
