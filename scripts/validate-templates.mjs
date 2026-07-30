/**
 * Prepublish Template Validation CI Guard (#493 work item 2).
 *
 * Runs the CLI's prepublish validate command (`frontx validate`) — manifest
 * contract PLUS content self-containment (#493) — against every
 * `template-*` directory at the repo root. No CI job invoked this command
 * before #493; the CLI has always had it (`cpt-frontx-dod-template-manifest-
 * validate-command`), but nothing wired it into a pipeline.
 *
 * Generic by construction: no template name is hardcoded, so a future
 * template — the #470 shell/mfe split included — is covered by simply
 * existing at the repo root as `template-*`, with no change to this script
 * or the workflow step that runs it.
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
import { createFsListSubtreeFilesFn, createFsReadFileFn, validateCommand } from '@gears-frontx/cli';

/**
 * Every top-level `template-*` directory at the repo root.
 *
 * @param {string} rootDir
 * @returns {string[]} absolute paths
 */
export function findTemplateDirs(rootDir) {
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('template-'))
    .map((entry) => path.join(rootDir, entry.name));
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
