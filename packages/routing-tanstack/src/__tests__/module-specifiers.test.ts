import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifySpecifier,
  collectReachableModuleSpecifiers,
  extractModuleSpecifiers,
} from './helpers/module-specifiers.js';

// Unit-tests the extractor/classifier
// `dist-imports.test.ts` relies on, against a fixture rather than a real
// `tsc` build — this is what actually proves the regex covers the dynamic
// `import("…")` form a per-file `tsc` emit uses (a check matching only
// `from '…'` would miss it).
describe('extractModuleSpecifiers', () => {
  it('captures a static `from` import, a dynamic `import()` type reference, a relative path, and a node: builtin', () => {
    const fixture = `
export type Foo = typeof import("@tanstack/react-router").Router;
import { bar } from 'react';
export { baz } from './local-file.js';
declare function readsFs(fs: typeof import("node:fs")): void;
`;
    expect(extractModuleSpecifiers(fixture)).toEqual([
      '@tanstack/react-router',
      'react',
      './local-file.js',
      'node:fs',
    ]);
  });

  it('returns no specifiers for a file that imports nothing', () => {
    expect(extractModuleSpecifiers('export declare const x: number;')).toEqual([]);
  });
});

describe('collectReachableModuleSpecifiers', () => {
  let fixtureDir: string | undefined;

  afterEach(() => {
    if (fixtureDir !== undefined) {
      rmSync(fixtureDir, { recursive: true, force: true });
      fixtureDir = undefined;
    }
  });

  it('returns exactly the specifiers reachable from the entry through relative imports, across a cycle, and none from an unreached file', () => {
    fixtureDir = mkdtempSync(path.join(tmpdir(), 'module-specifiers-'));
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(path.join(fixtureDir, 'index.d.ts'), "export { a } from './a.js';\n");
    writeFileSync(
      path.join(fixtureDir, 'a.d.ts'),
      "import type { ReactNode } from 'react';\nexport { x } from './index.js';\n",
    );
    writeFileSync(path.join(fixtureDir, 'orphan.d.ts'), "import { pad } from 'left-pad';\n");

    const reached = collectReachableModuleSpecifiers(path.join(fixtureDir, 'index.d.ts'));

    expect(Array.from(reached).sort()).toEqual(['./a.js', './index.js', 'react']);
  });
});

describe('classifySpecifier', () => {
  const declared = new Set(['react', '@tanstack/react-router']);

  it('classifies a declared dependency as declared', () => {
    expect(classifySpecifier('@tanstack/react-router', declared)).toBe('declared');
    expect(classifySpecifier('react', declared)).toBe('declared');
  });

  it('classifies a relative path as relative, regardless of whether it is also declared', () => {
    expect(classifySpecifier('./local-file.js', declared)).toBe('relative');
    expect(classifySpecifier('/abs/path.js', declared)).toBe('relative');
  });

  it('classifies an undeclared node: builtin as undeclared — this package declares none', () => {
    expect(classifySpecifier('node:fs', declared)).toBe('undeclared');
  });

  it('classifies any other non-relative, non-declared specifier as undeclared', () => {
    expect(classifySpecifier('left-pad', declared)).toBe('undeclared');
  });
});
