// Extraction/classification helpers for `dist-imports.test.ts`, pulled
// out into their own module so the regex and the declared/relative
// classification rule can be unit-tested directly against a fixture,
// without paying for a real `tsc` build per assertion.
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Matches both the static form (`import { x } from '…'`, `export { x } from
// '…'`) and the dynamic type-only form TypeScript emits for a declaration
// it can only reference lazily (`import("…").Foo`) — a per-file `tsc` emit
// uses the latter routinely for a type that is used, but not re-exported,
// by the file doing the importing — a check matching only `from '…'`
// would miss it.
const SPECIFIER_PATTERN = /(?:from\s+|import\()\s*['"]([^'"]+)['"]/g;

/** Every module specifier a single `.d.ts` file's text imports from — in
 * the order they first appear, duplicates included (callers that only care
 * about the set of distinct specifiers dedupe themselves). */
export function extractModuleSpecifiers(dts: string): string[] {
  return Array.from(dts.matchAll(SPECIFIER_PATTERN), (match) => match[1]);
}

/** Every module specifier imported by `entry` (an emitted `.d.ts`) or by any
 * `.d.ts` it reaches through relative imports — a per-file `tsc` emit (as
 * opposed to a single rolled-up bundle) spreads a package's own import
 * surface across several files, so reading only the entry point's own
 * `index.d.ts` understates it, while reading every emitted file also counts
 * internal declarations no published entry reaches. */
export function collectReachableModuleSpecifiers(entry: string): Set<string> {
  const specifiers = new Set<string>();
  const visited = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (visited.has(file)) {
      continue;
    }
    visited.add(file);
    for (const specifier of extractModuleSpecifiers(readFileSync(file, 'utf-8'))) {
      specifiers.add(specifier);
      if (specifier.startsWith('.')) {
        pending.push(path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.d.ts')));
      }
    }
  }
  return specifiers;
}

export type SpecifierClass = 'relative' | 'declared' | 'undeclared';

/** A specifier is safe to publish only if it resolves without this
 * package's own `dependencies`/`peerDependencies` doing the work implicitly
 * — a relative path (resolves on its own, no package lookup involved) or a
 * specifier this package's own `package.json` actually declares. Anything
 * else — including a Node builtin like `node:path`, which this package
 * happens not to declare — is `'undeclared'`: correct for this package (it
 * has none), and exactly the behaviour a package that legitimately needs
 * one would have to declare it for. */
export function classifySpecifier(specifier: string, declared: ReadonlySet<string>): SpecifierClass {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return 'relative';
  }
  return declared.has(specifier) ? 'declared' : 'undeclared';
}
