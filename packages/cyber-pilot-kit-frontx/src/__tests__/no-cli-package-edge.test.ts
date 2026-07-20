// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1
//
// Guard: `@gears-frontx/cyber-pilot-kit-frontx` holds NO intra-ecosystem
// package edge to `@gears-frontx/cli` — coordination with the CLI happens
// ONLY over its command/invocation surface (DESIGN §3.4;
// cpt-frontx-dod-ai-upgrade-orchestration-single-engine). This source-string
// guard complements the dependency-cruiser rule
// (`frontx-single-intra-ecosystem-edge-kit-standalone` in
// `.dependency-cruiser.cjs`) with a fast, package-local check.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(name)) {
      files.push(full);
    }
  }
  return files;
}

// Matches an actual ESM/CJS import or require specifier naming the CLI
// package — not prose mentions of the package name in comments/docstrings
// (this guard file and the adapter's own doc-comments legitimately name it).
const CLI_IMPORT_PATTERN = /(?:from\s+|require\()\s*['"]@gears-frontx\/cli(?:\/[^'"]*)?['"]/;

describe('no @gears-frontx/cli package edge (cpt-frontx-dod-ai-upgrade-orchestration-single-engine)', () => {
  it('contains no import/require specifier naming @gears-frontx/cli anywhere in kit source', () => {
    const selfPath = fileURLToPath(import.meta.url);
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      if (file === selfPath) continue; // this guard's own doc-comments name the package in prose
      const content = readFileSync(file, 'utf-8');
      if (CLI_IMPORT_PATTERN.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
