/**
 * Template Pin-Drift CI Guard (#493 work item 3).
 *
 * PR #492 (#485) pinned the FrontX ecosystem packages a template consumes
 * (`@gears-frontx/api`, `mfes`, `gts-plugin`) to exact registry versions
 * across every `package.json` that declares them — 14 sites across 5
 * manifests in `template-standard/` alone. A manual version bump to
 * `packages/api/package.json` (etc.) that misses even one of those sites
 * ships a template with a mixed version set, and the in-monorepo dev loop
 * (`dev:template:link`) actively masks it: it links local sources regardless
 * of what's pinned, so the drift is invisible until a real `npm install`
 * outside the monorepo.
 *
 * This check is deliberately NOT a static list of 14 file paths — the list
 * itself would be exactly the kind of duplicated knowledge this guard exists
 * to prevent, and it would silently stop covering new sites the #470
 * template split introduces. Instead it discovers every pin site
 * structurally: for every `package.json` under every template directory
 * (a directory carrying `frontx-template.json`, excluding `node_modules`),
 * any exact-pinned dependency naming one of the governed ecosystem packages
 * is a site, compared against that package's actual on-disk version under
 * `packages/`. Templates themselves are discovered by manifest presence
 * (ADR-0018), not by a `template-*` name prefix, so a renamed or relocated
 * template is still covered — and zero templates found is a hard failure,
 * never a vacuous pass.
 *
 * CLI entry: `node scripts/template-pin-drift-check.mjs` (exit 0 on success).
 * Core logic is exported for unit tests in
 * `scripts/template-pin-drift-check.test.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { isExactPin } from './ecosystem-version-policy.mjs';
import { templatePinnedEcosystemPackageDirs } from './template-ecosystem-packages.mjs';

// Mirrors `DEPENDENCY_FIELDS` (`packages/cli/src/manifest/validate-content-
// self-containment.ts`) — kept as a local literal, not an import, so this
// script never depends on `@gears-frontx/cli` being built (unlike
// `validate-templates.mjs`, which already needs the built CLI for
// `validateCommand` and pays that cost deliberately). Exported so
// `template-pin-drift-check.test.mjs` can assert it stays in sync with the
// TypeScript source (#492 review finding 2's "unguarded duplicated literal"
// class — a guard test is the affordable way to keep two copies honest
// without adding a build dependency to either script).
export const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

// Mirrors `MANIFEST_FILENAME` (`packages/cli/src/manifest/types.ts`) — kept
// as a local literal rather than an import so this script keeps working
// straight after `npm ci`, with no `build:packages:cli` prerequisite; a
// single stable filename literal is a far smaller duplication risk than the
// package-list duplication `template-ecosystem-packages.mjs` exists to close.
// Exported for the same sync-guard-test reason as `DEPENDENCY_FIELDS` above.
export const MANIFEST_FILENAME = 'frontx-template.json';

/**
 * Reads the ACTUAL on-disk version of every ecosystem package a template
 * pins — the truth a pinned site is compared against. FAILS CLOSED: a
 * missing/empty `name` or `version` doesn't silently poison the truth map
 * (an undefined `name` would key the entry as the literal string
 * `"undefined"`, and the real package would then have NO truth entry at
 * all — `findDriftedSites` treats "no truth entry" as "not drifted", so
 * every pinned site for that package would silently stop being checked;
 * CodeRabbit review finding on #493). Throws naming the offending file
 * instead, so a malformed ecosystem manifest halts the check loudly rather
 * than quietly disabling it.
 *
 * @param {string} rootDir monorepo root
 * @returns {Record<string, string>} package name (e.g. "@gears-frontx/api") -> its current version
 */
export function readEcosystemTruthVersions(rootDir) {
  /** @type {Record<string, string>} */
  const truth = {};
  for (const dir of templatePinnedEcosystemPackageDirs) {
    const packageJsonPath = path.join(rootDir, 'packages', dir, 'package.json');
    /** @type {unknown} */
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const name = /** @type {{ name?: unknown }} */ (packageJson).name;
    const version = /** @type {{ version?: unknown }} */ (packageJson).version;
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error(`[template-pin-drift-check] ${packageJsonPath} has no valid "name" — cannot build the ecosystem truth map.`);
    }
    if (typeof version !== 'string' || version.trim() === '') {
      throw new Error(`[template-pin-drift-check] ${packageJsonPath} has no valid "version" — cannot build the ecosystem truth map.`);
    }
    truth[name] = version;
  }
  return truth;
}

/**
 * Recursively finds every `package.json` under `dir`, never descending into
 * `node_modules` (install-time output, never committed template content).
 * DOES descend into a dot-prefixed directory: a pinned dependency site inside
 * a hidden directory is exactly as real as one anywhere else, and skipping it
 * would silently stop checking it — the same completeness hole CodeRabbit's
 * review found in `createFsListContentOwnedFilesFn` (#493), fixed here for
 * consistency before it recurred as a separate finding.
 *
 * @param {string} dir
 * @returns {string[]} absolute paths
 */
export function findPackageJsonFiles(dir) {
  /** @type {string[]} */
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findPackageJsonFiles(full));
    } else if (entry.isFile() && entry.name === 'package.json') {
      results.push(full);
    }
  }
  return results;
}

/**
 * @typedef {{ file: string; field: string; packageName: string; pinnedVersion: string }} PinSite
 */

/**
 * Finds every exact-pin dependency site, across every `package.json` under
 * `templateDir`, that names one of the governed ecosystem packages. Generic
 * by construction: no template name, no file path is hardcoded — a future
 * template inherits the check unchanged by simply existing at the repo root.
 *
 * @param {string} templateDir absolute path
 * @param {string[]} governedPackageNames e.g. ["@gears-frontx/api", ...]
 * @returns {PinSite[]}
 */
export function findPinSites(templateDir, governedPackageNames) {
  /** @type {PinSite[]} */
  const sites = [];
  for (const filePath of findPackageJsonFiles(templateDir)) {
    /** @type {unknown} */
    let packageJson;
    try {
      packageJson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      continue; // a malformed package.json is caught by other tooling, not this policy
    }
    if (typeof packageJson !== 'object' || packageJson === null) continue;
    const obj = /** @type {Record<string, unknown>} */ (packageJson);

    for (const field of DEPENDENCY_FIELDS) {
      const depMap = obj[field];
      if (typeof depMap !== 'object' || depMap === null) continue;
      for (const packageName of governedPackageNames) {
        const range = /** @type {Record<string, unknown>} */ (depMap)[packageName];
        if (typeof range !== 'string' || !isExactPin(range)) continue;
        sites.push({ file: path.relative(templateDir, filePath), field, packageName, pinnedVersion: range });
      }
    }
  }
  return sites;
}

/**
 * @param {PinSite[]} sites
 * @param {Record<string, string>} truthVersions
 * @returns {Array<PinSite & { actualVersion: string }>}
 */
export function findDriftedSites(sites, truthVersions) {
  return sites
    .filter((site) => {
      const actual = truthVersions[site.packageName];
      return actual !== undefined && actual !== site.pinnedVersion;
    })
    .map((site) => ({ ...site, actualVersion: truthVersions[site.packageName] }));
}

/**
 * Every top-level directory at the repo root that carries `frontx-template.json`
 * — a template is defined by its manifest (ADR-0018), not by a `template-*`
 * name prefix. Location- and name-independent: the #470 split is covered
 * whatever the resulting templates end up named (A5 review finding on #493 —
 * a name-prefix glob would vacuously stop finding a renamed/relocated
 * template instead of failing).
 *
 * `node_modules` is the ONE exclusion (install-time output, never something
 * this repo's own tree defines); a dot-prefixed top-level directory (`.git`,
 * `.github`, `.cf-studio`, ...) is NOT excluded — filtering it out would
 * reintroduce exactly the naming/location assumption the manifest-presence
 * principle exists to drop, and the one `fs.existsSync` check per top-level
 * entry this costs is negligible (CodeRabbit review finding on #493 —
 * matches the same node_modules-only rule `validate-templates.mjs` and
 * `createFsListContentOwnedFilesFn` apply).
 *
 * @param {string} rootDir
 * @returns {string[]} absolute paths, sorted
 */
export function findTemplateDirs(rootDir) {
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry) => path.join(rootDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, MANIFEST_FILENAME)))
    .sort();
}

/**
 * CI entry point. Wired into `npm run policy:template-pin-drift` and
 * `.github/workflows/main.yml`.
 *
 * @param {{ rootDir?: string }} [options]
 * @returns {number} 0 on success, 1 on failure.
 */
export function runCli(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const truthVersions = readEcosystemTruthVersions(rootDir);
  const governedPackageNames = Object.keys(truthVersions);

  const templateDirs = findTemplateDirs(rootDir);

  // A5 review finding: zero templates found is never a silent pass — a glob
  // that stops matching (a rename, a relocation) would otherwise report
  // "0 drifted sites" as success. Either no template exists (unexpected —
  // this repo always ships at least one) or discovery is broken; either way
  // a human needs to see it.
  if (templateDirs.length === 0) {
    console.error(`[template-pin-drift-check] FAIL: no template found under ${rootDir} (looked for a top-level directory carrying ${MANIFEST_FILENAME}).`);
    return 1;
  }

  /** @type {Array<PinSite & { actualVersion: string; templateName: string }>} */
  const allDrifted = [];
  for (const templateDir of templateDirs) {
    const sites = findPinSites(templateDir, governedPackageNames);
    const drifted = findDriftedSites(sites, truthVersions);
    allDrifted.push(...drifted.map((site) => ({ ...site, templateName: path.basename(templateDir) })));
  }

  if (allDrifted.length > 0) {
    console.error(`[template-pin-drift-check] FAIL: ${allDrifted.length} pinned site(s) drifted from the ecosystem's actual version:`);
    for (const site of allDrifted) {
      console.error(
        `  ${site.templateName}/${site.file} ${site.field}["${site.packageName}"]: ` +
          `pinned ${site.pinnedVersion}, actual ${site.actualVersion}`,
      );
    }
    console.error(
      '\nBump the pinned site(s) above to match the package(s)\' actual version, then rerun ' +
        '`npm run policy:template-pin-drift` to confirm. Do NOT run `npm run dev:template:link` to ' +
        'investigate this — it links local sources regardless of what is pinned and would mask the drift.',
    );
    return 1;
  }

  console.log(
    `Template pin-drift check passed: all pinned sites match the ecosystem's actual versions ` +
      `(${Object.entries(truthVersions)
        .map(([name, version]) => `${name}@${version}`)
        .join(', ')}).`,
  );
  return 0;
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  process.exit(runCli());
}
