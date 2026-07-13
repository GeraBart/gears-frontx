// @cpt-algo:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { KitResourceEntry, ResourceBodyReader } from './types.js';

// @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-scan-solution-content
function collectFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Production `ResourceBodyReader`: resolves a declared resource's `source`
 * path relative to `kitRoot` and reads the actual shipped file contents from
 * disk — either the single file, or every file recursively under a
 * directory resource. Used by the kit's self-validation to scan shipped
 * resource BODIES (not just manifest id/description) for solution-specific
 * content, per `cpt-frontx-adr-base-solution-ai-content-split`.
 */
export function createFsResourceBodyReader(kitRoot: string): ResourceBodyReader {
  return {
    read(entry: KitResourceEntry): string[] {
      const target = join(kitRoot, entry.source);
      const stat = statSync(target);
      const files = stat.isDirectory() ? collectFilesRecursive(target) : [target];
      return files.map((file) => readFileSync(file, 'utf-8'));
    },
  };
}
// @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-scan-solution-content
