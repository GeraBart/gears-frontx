import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `cpt-frontx-constraint-routing-no-intra-ecosystem-dependency` (FEATURE
// route-ownership-signal §1.4, Constraints) and DESIGN §2.3: the router reaches
// the runtime only through the executor and type system it is handed. The
// package source imports no other @gears-frontx package and names no GTS id.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) {
      return name === '__tests__' ? [] : sourceFiles(full);
    }
    return full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
  });
}

const files = sourceFiles(SRC);

describe('package source boundary', () => {
  it('scans the package source files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports nothing from @gears-frontx/mfes or from any other @gears-frontx package', () => {
    const importOfPackage = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]@gears-frontx\//;
    const offenders = files.filter((file) => importOfPackage.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });

  it('contains no GTS id literal', () => {
    const gtsLiteral = /['"`]gts\./;
    const offenders = files.filter((file) => gtsLiteral.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });
});
