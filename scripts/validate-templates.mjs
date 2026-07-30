/**
 * Prepublish Template Validation CI Guard (#493 work item 2).
 *
 * Runs the CLI's prepublish validate command (`frontx validate`) — manifest
 * contract PLUS content self-containment (#493) — against every template at
 * the repo root. No CI job invoked this command before #493; the CLI has
 * always had it (`cpt-frontx-dod-template-manifest-validate-command`), but
 * nothing wired it into a pipeline.
 *
 * Generic by construction: no template name is hardcoded. A directory counts
 * as a template by carrying `frontx-template.json` at its root — the manifest
 * IS what defines a template (ADR-0018) — not by a `template-*` naming
 * convention, so this is location- and name-independent: a future template
 * (the #470 shell/mfe split included) is covered whatever it ends up named or
 * located at the repo root, with no change to this script or the workflow
 * step that runs it (A5 review finding on #493 — a name-prefix glob would
 * vacuously pass if #470 renames or relocates a template).
 *
 * Imports `@gears-frontx/cli`'s command directly rather than spawning the
 * built `frontx` binary as a child process — one less path assumption, and it
 * runs against the exact in-repo build `npm run build:packages:cli` just
 * produced.
 *
 * CLI entry: `node scripts/validate-templates.mjs` (exit 0 on success).
 * Core logic is exported for unit tests in
 * `scripts/validate-templates.test.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { createFsListSubtreeFilesFn, createFsReadFileFn, MANIFEST_FILENAME, validateCommand } from '@gears-frontx/cli';

/**
 * Every top-level directory at the repo root that carries `frontx-template.json`
 * — a template is defined by its manifest (ADR-0018), not by where it lives
 * or what it's named.
 *
 * @param {string} rootDir
 * @returns {string[]} absolute paths, sorted
 */
export function findTemplateDirs(rootDir) {
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
    .map((entry) => path.join(rootDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, MANIFEST_FILENAME)))
    .sort();
}

/**
 * @param {{
 *   rootDir?: string;
 *   readFileFn?: import('@gears-frontx/cli').ReadFileFn;
 *   listSubtreeFilesFn?: import('@gears-frontx/cli').ListSubtreeFilesFn;
 *   log?: (line: string) => void;
 *   logError?: (line: string) => void;
 * }} [options]
 * @returns {Promise<number>} 0 on success, 1 on failure.
 */
export async function runCli(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const readFileFn = options.readFileFn ?? createFsReadFileFn();
  const listSubtreeFilesFn = options.listSubtreeFilesFn ?? createFsListSubtreeFilesFn();
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;

  const templateDirs = findTemplateDirs(rootDir);

  // A5 review finding: an empty result is never a silent pass. It means
  // either no template exists (unexpected — this repo always ships at least
  // one) or discovery is broken (wrong `rootDir`, a renamed manifest
  // filename) — either way, a human needs to see it, not a green checkmark.
  if (templateDirs.length === 0) {
    logError(`[validate-templates] FAIL: no template found under ${rootDir} (looked for a top-level directory carrying ${MANIFEST_FILENAME}).`);
    return 1;
  }

  let failed = false;

  for (const templateDir of templateDirs) {
    const templateName = path.basename(templateDir);
    const result = await validateCommand(templateDir, readFileFn, listSubtreeFilesFn);
    if (result.ok) {
      log(`[validate-templates] PASS: ${templateName}`);
    } else {
      failed = true;
      logError(`[validate-templates] FAIL: ${templateName}\n${result.message}`);
    }
  }

  return failed ? 1 : 0;
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  process.exit(await runCli());
}
