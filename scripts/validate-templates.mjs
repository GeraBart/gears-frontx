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
 * produced. That import is DYNAMIC (`loadCliModule` below), not a static
 * top-level `import`: a static import fails module EVALUATION itself with
 * node's raw `ERR_MODULE_NOT_FOUND` stack trace the instant `packages/cli/dist`
 * is missing (a fresh clone, a `clean:artifacts` run) — before this script's
 * own code ever runs, so it can't be caught or turned into a clear message.
 * The dynamic import runs inside `runCli`, where a missing build is caught
 * and reported as an actionable instruction instead (the #492 review's
 * "confusing module-resolution error" class, finding 3).
 *
 * CLI entry: `node scripts/validate-templates.mjs` (exit 0 on success).
 * Core logic is exported for unit tests in
 * `scripts/validate-templates.test.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * Every top-level directory at the repo root that carries `manifestFilename`
 * — a template is defined by its manifest (ADR-0018), not by where it lives
 * or what it's named. `manifestFilename` is passed in (rather than imported)
 * so this function stays independent of whether `@gears-frontx/cli` loaded.
 *
 * @param {string} rootDir
 * @param {string} manifestFilename
 * @returns {string[]} absolute paths, sorted
 */
export function findTemplateDirs(rootDir, manifestFilename) {
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
    .map((entry) => path.join(rootDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, manifestFilename)))
    .sort();
}

/**
 * @param {unknown} error
 * @returns {boolean} whether `error` is node's "module not found" error —
 *   the shape a missing `packages/cli/dist` produces on `import('@gears-frontx/cli')`.
 */
function isModuleNotFoundError(error) {
  return Boolean(error) && typeof error === 'object' && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND';
}

/**
 * Dynamically imports `@gears-frontx/cli`, mapping a missing build to a
 * clear, actionable result instead of letting node's raw
 * `ERR_MODULE_NOT_FOUND` stack trace reach the caller unexplained (#492
 * review finding 3's "confusing module-resolution error" class).
 *
 * @param {(specifier: string) => Promise<unknown>} [importFn] injected for testing
 * @returns {Promise<{ ok: true; module: typeof import('@gears-frontx/cli') } | { ok: false; message: string }>}
 */
export async function loadCliModule(importFn = (specifier) => import(specifier)) {
  try {
    const module = /** @type {typeof import('@gears-frontx/cli')} */ (await importFn('@gears-frontx/cli'));
    return { ok: true, module };
  } catch (error) {
    if (isModuleNotFoundError(error)) {
      return {
        ok: false,
        message:
          'built @gears-frontx/cli not found (packages/cli/dist is missing) — run `npm run build:packages:cli` first.',
      };
    }
    throw error;
  }
}

/**
 * @param {{
 *   rootDir?: string;
 *   loadCliModule?: typeof loadCliModule;
 *   readFileFn?: import('@gears-frontx/cli').ReadFileFn;
 *   listSubtreeFilesFn?: import('@gears-frontx/cli').ListSubtreeFilesFn;
 *   log?: (line: string) => void;
 *   logError?: (line: string) => void;
 * }} [options]
 * @returns {Promise<number>} 0 on success, 1 on failure.
 */
export async function runCli(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;

  const loaded = await (options.loadCliModule ?? loadCliModule)();
  if (!loaded.ok) {
    logError(`[validate-templates] FAIL: ${loaded.message}`);
    return 1;
  }
  const { createFsListSubtreeFilesFn, createFsReadFileFn, MANIFEST_FILENAME, validateCommand } = loaded.module;

  const readFileFn = options.readFileFn ?? createFsReadFileFn();
  const listSubtreeFilesFn = options.listSubtreeFilesFn ?? createFsListSubtreeFilesFn();

  const templateDirs = findTemplateDirs(rootDir, MANIFEST_FILENAME);

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
