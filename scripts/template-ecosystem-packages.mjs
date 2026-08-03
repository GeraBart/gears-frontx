/**
 * What this repo's FrontX ecosystem IS, and which of its packages a template
 * pins - both DERIVED from manifests on disk, never declared.
 *
 * The predecessor of this module declared them: `['api', 'mfes', 'gts-plugin']`,
 * one constant shared by the pin-drift CI guard and the dev-link script so the
 * two could not disagree. Sharing was right; the array was the bug. #496 added
 * `packages/telemetry` while #493 was in review, and nothing in either tool
 * noticed: a template pinning `@gears-frontx/telemetry` at a stale version was
 * silently unchecked by the guard and silently left unlinked by the dev loop. A
 * list a human must remember to edit is exactly the duplicated knowledge these
 * tools exist to prevent, so there is no package array here at all.
 *
 * ## The ecosystem truth map
 *
 * Every `packages/*` manifest contributes `name -> version`. Not a curated
 * subset: `cli` and `cyber-pilot-kit-frontx` are never installed by a seeded
 * project, but including them costs nothing (no template pins them) and makes a
 * pin on them verifiable rather than unverifiable. A `packages/*` directory with
 * NO manifest is skipped - a stray directory or a cleaned build output is not a
 * package. A manifest that IS there but cannot be read, cannot be parsed, or
 * declares no `name`/`version` FAILS CLOSED naming the file: an unusable
 * manifest must never read as "this package has no version to compare against",
 * which is indistinguishable from "none of its pin sites drifted".
 *
 * ## A pin on a name the truth map does not have
 *
 * FAILS LOUDLY, naming the site - a pin this repo cannot verify is not a pin
 * this repo may assume correct. Deleting `packages/api/package.json` is what
 * makes that rule load-bearing: `@gears-frontx/api` drops out of the truth map,
 * and without this rule every pin on it would quietly stop being compared
 * (`findDriftedSites` cannot distinguish "no truth entry" from "matches"). With
 * it, the missing manifest surfaces at the pin sites that depend on it.
 *
 * The one exception is a name the scanned tree DEFINES itself, which npm
 * resolves locally through a workspace whatever range it carries, so no
 * registry version exists for it to drift from. That exception is not a
 * courtesy: `template-shell` is a workspace root (`workspaces: ["packages/*",
 * ...]`) whose members are `@gears-frontx/auth`, `@gears-frontx/state` and
 * friends - names in the ecosystem's own npm scope that this repo's `packages/`
 * deliberately does not publish. The monorepo's own manifests get the same
 * treatment against the names its root `workspaces` declare, which is why
 * `internal/*` (`@gears-frontx/eslint-config`, `@gears-frontx/depcruise-config`)
 * needs no special case despite being outside the truth map.
 *
 * The npm scope itself is derived from the truth map's own names, so not even
 * the string `@gears-frontx` is written down here.
 *
 * Consumers: `template-pin-drift-check.mjs` (compares every pin site against
 * the truth map) and `link-template-ecosystem.mjs` (repoints exactly the
 * directories the template pins at their local builds).
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Mirrors `DEPENDENCY_FIELDS` (`packages/cli/src/manifest/validate-content-
 * self-containment.ts`) - kept as a local literal, not an import, so no
 * repo-script depends on `@gears-frontx/cli` being built (unlike
 * `validate-templates.mjs`, which already needs the built CLI for
 * `validateCommand` and pays that cost deliberately). Kept honest by the
 * sync-guard test in `template-ecosystem-packages.test.mjs` rather than by
 * hope (#492 review finding 2's "unguarded duplicated literal" class).
 */
export const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * @typedef {{ dir: string; name: string; version: string }} EcosystemPackage
 * @typedef {{ file: string; field: string; packageName: string; pinnedVersion: string }} PinSite
 */

/**
 * Reads and parses one `package.json`. FAILS CLOSED on every way the operation
 * can fail - an unreadable file, unparseable JSON, a non-object body - each
 * aborting with a message NAMING the file rather than escaping as node's raw
 * `ENOENT`/`SyntaxError`, which names neither the file's role nor the tool that
 * wanted it (so a red build reads as a broken script instead of a broken
 * manifest).
 *
 * @param {string} packageJsonPath
 * @returns {Record<string, unknown>}
 */
export function readPackageManifest(packageJsonPath) {
  /** @type {string} */
  let raw;
  try {
    raw = fs.readFileSync(packageJsonPath, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${packageJsonPath} (${describeError(error)}) - no pin site it declares or defines can be checked.`);
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `cannot parse ${packageJsonPath} as JSON (${describeError(error)}) - no pin site it declares or defines can be checked.`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${packageJsonPath} is not a JSON object - no pin site it declares or defines can be checked.`);
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every package `packages/*` publishes, in directory order. See the module
 * docblock for why the set is every directory rather than a governed subset,
 * and why a missing manifest is skipped while an unusable one is fatal.
 *
 * @param {string} rootDir monorepo root
 * @returns {EcosystemPackage[]}
 */
export function readEcosystemPackages(rootDir) {
  const packagesDir = path.join(rootDir, 'packages');
  if (!fs.existsSync(packagesDir)) return [];

  /** @type {EcosystemPackage[]} */
  const packages = [];
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const manifestPath = path.join(packagesDir, entry.name, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = readPackageManifest(manifestPath);
    const name = manifest['name'];
    const version = manifest['version'];
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error(`${manifestPath} has no valid "name" - the ecosystem truth map cannot be built.`);
    }
    if (typeof version !== 'string' || version.trim() === '') {
      throw new Error(`${manifestPath} has no valid "version" - the ecosystem truth map cannot be built.`);
    }
    packages.push({ dir: entry.name, name, version });
  }
  return packages;
}

/**
 * The truth a pinned site is compared against: package name -> current version.
 *
 * @param {string} rootDir monorepo root
 * @returns {Record<string, string>}
 */
export function readEcosystemTruthVersions(rootDir) {
  return Object.fromEntries(readEcosystemPackages(rootDir).map(({ name, version }) => [name, version]));
}

/**
 * Answers "is this dependency name one of OURS" from the truth map's own names,
 * so the npm scope is never written down. An unscoped ecosystem package
 * contributes no scope and therefore makes no name suspicious - its own pins
 * are still compared, since that comparison keys on the exact name.
 *
 * @param {Iterable<string>} ecosystemPackageNames
 * @returns {(candidate: string) => boolean}
 */
export function ecosystemScopeMatcher(ecosystemPackageNames) {
  /** @type {Set<string>} */
  const scopes = new Set();
  for (const name of ecosystemPackageNames) {
    const scope = scopeOf(name);
    if (scope !== null) scopes.add(scope);
  }
  return (candidate) => {
    const scope = scopeOf(candidate);
    return scope !== null && scopes.has(scope);
  };
}

/**
 * @param {string} packageName
 * @returns {string | null} `"@scope"`, or `null` for an unscoped name
 */
function scopeOf(packageName) {
  if (!packageName.startsWith('@')) return null;
  const slash = packageName.indexOf('/');
  return slash > 0 ? packageName.slice(0, slash) : null;
}

/**
 * A dependency range is a pin THIS policy governs only when it is a bare exact
 * registry version (`0.3.0-alpha.1`). `isExactPin` alone is the wrong question:
 * it answers "does this range carry a range operator", and a
 * `file:`/`link:`/`workspace:`/`git+…` specifier carries none either - so it
 * classified every monorepo-local `file:../../../packages/mfes` as a pinned
 * site and reported it as drifted from a version it was never expressing. A
 * local-path specifier is the CONTENT self-containment check's subject
 * (`validate-content-self-containment.ts`), never a version to compare.
 *
 * @param {string} range
 * @returns {boolean}
 */
export function isExactRegistryVersionPin(range) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(range.trim());
}

/**
 * Recursively finds every `package.json` under `dir`, never descending into
 * `node_modules` (install-time output, never committed content). DOES descend
 * into a dot-prefixed directory: a pinned dependency site inside a hidden
 * directory is exactly as real as one anywhere else, and skipping it would
 * silently stop checking it - the same completeness hole CodeRabbit's review
 * found in `createFsListContentOwnedFilesFn` (#493), closed here too.
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
 * Collects every exact-registry-version pin site one already-parsed manifest
 * declares on a name in the ecosystem's npm scope. The single place that decides
 * what "a pin site" is, so a template's tree and the ecosystem's own manifests
 * are judged by one rule rather than two copies of it.
 *
 * The dependency MAP is iterated, not a list of governed names: that is
 * precisely how a package added to `packages/` after this code was written gets
 * discovered without anyone editing anything.
 *
 * @param {Record<string, unknown>} packageJson
 * @param {string} reportedFile path to report the site at
 * @param {(name: string) => boolean} isEcosystemScopeName
 * @returns {PinSite[]}
 */
export function pinSitesIn(packageJson, reportedFile, isEcosystemScopeName) {
  /** @type {PinSite[]} */
  const sites = [];
  const selfName = typeof packageJson['name'] === 'string' ? packageJson['name'] : undefined;

  for (const field of DEPENDENCY_FIELDS) {
    const depMap = packageJson[field];
    if (typeof depMap !== 'object' || depMap === null || Array.isArray(depMap)) continue;
    for (const [packageName, range] of Object.entries(/** @type {Record<string, unknown>} */ (depMap))) {
      // A package pinning ITSELF is not a drift site: the pin and the truth
      // would be the same declaration, so the comparison could only ever
      // report a package as drifted from its own version.
      if (packageName === selfName) continue;
      if (typeof range !== 'string' || !isExactRegistryVersionPin(range)) continue;
      if (!isEcosystemScopeName(packageName)) continue;
      sites.push({ file: reportedFile, field, packageName, pinnedVersion: range });
    }
  }
  return sites;
}

/**
 * Walks every `package.json` in one tree, returning both the ecosystem pin
 * sites it declares and the package names the tree DEFINES.
 *
 * The second half is what tells a pin on a locally-resolved workspace member
 * apart from a pin on a name this repo is expected to publish (see the module
 * docblock) - and it is collected from the same parse, so it costs nothing.
 *
 * Every manifest is read through `readPackageManifest`, so an unreadable or
 * malformed one aborts naming the file instead of counting as "zero pins here"
 * (a review finding on #493: fail-open was the one thing this guard could not
 * afford, since silence is also what success looks like).
 *
 * @param {string} treeDir absolute path
 * @param {(name: string) => boolean} isEcosystemScopeName
 * @returns {{ sites: PinSite[]; definedPackageNames: Set<string> }}
 */
export function scanTreePins(treeDir, isEcosystemScopeName) {
  /** @type {PinSite[]} */
  const sites = [];
  /** @type {Set<string>} */
  const definedPackageNames = new Set();

  for (const filePath of findPackageJsonFiles(treeDir)) {
    const manifest = readPackageManifest(filePath);
    const name = manifest['name'];
    if (typeof name === 'string' && name.trim() !== '') definedPackageNames.add(name);
    sites.push(...pinSitesIn(manifest, path.relative(treeDir, filePath), isEcosystemScopeName));
  }
  return { sites, definedPackageNames };
}

/**
 * Every package name this repo defines locally, from the directories its root
 * `workspaces` patterns select. npm resolves these through the workspace
 * regardless of the range written against them, so they can never install a
 * registry tarball and can never drift - which is what exempts them from the
 * "unverifiable pin" failure without exempting them from anything else.
 *
 * Each pattern is taken up to its first wildcard segment and the directories
 * one level below that prefix are read, which covers the `<dir>/*` shape npm
 * workspaces use in practice. A pattern naming a directory literally works too.
 * Nothing here needs to be exhaustive: a name it misses only costs a loud,
 * actionable failure at the pin site, never a silent pass.
 *
 * @param {string} rootDir monorepo root
 * @returns {Set<string>}
 */
export function readRepoDefinedPackageNames(rootDir) {
  /** @type {Set<string>} */
  const names = new Set();
  const rootManifestPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(rootManifestPath)) return names;

  const rootManifest = readPackageManifest(rootManifestPath);
  const rootName = rootManifest['name'];
  if (typeof rootName === 'string' && rootName.trim() !== '') names.add(rootName);

  const patterns = Array.isArray(rootManifest['workspaces']) ? rootManifest['workspaces'] : [];
  for (const pattern of patterns) {
    if (typeof pattern !== 'string') continue;
    for (const memberDir of workspaceMemberDirs(rootDir, pattern)) {
      const manifestPath = path.join(memberDir, 'package.json');
      if (!fs.existsSync(manifestPath)) continue;
      const name = readPackageManifest(manifestPath)['name'];
      if (typeof name === 'string' && name.trim() !== '') names.add(name);
    }
  }
  return names;
}

/**
 * @param {string} rootDir
 * @param {string} pattern a root `workspaces` entry
 * @returns {string[]} absolute directories the pattern selects
 */
function workspaceMemberDirs(rootDir, pattern) {
  const segments = pattern.split('/').filter((segment) => segment !== '' && segment !== '.');
  const literal = [];
  for (const segment of segments) {
    if (segment.includes('*')) break;
    literal.push(segment);
  }

  const prefixDir = path.join(rootDir, ...literal);
  if (!fs.existsSync(prefixDir)) return [];
  // A wildcard-free pattern names one directory; anything else expands to the
  // entries one level below the literal prefix.
  if (literal.length === segments.length) return [prefixDir];

  return fs
    .readdirSync(prefixDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry) => path.join(prefixDir, entry.name));
}

/**
 * The `packages/*` directories one template pins to the registry - the exact
 * set `dev:template:link` must repoint, because a published tarball is the only
 * thing that can shadow a local edit.
 *
 * Derived from the template's own manifests, not from a declaration: the linker
 * links what the template pins, so asking the template is the honest question.
 * A package the template reaches only through a `file:` specifier or a
 * `workspace:` range already resolves locally and needs no link; a package it
 * pins that this repo does not publish yields no directory to link and is left
 * for the pin-drift guard to report.
 *
 * @param {string} rootDir monorepo root
 * @param {string} templateDirName template directory, relative to `rootDir`
 * @returns {string[]} `packages/*` directory names, in ecosystem order
 */
export function templatePinnedPackageDirs(rootDir, templateDirName) {
  const ecosystem = readEcosystemPackages(rootDir);
  const isEcosystemScopeName = ecosystemScopeMatcher(ecosystem.map(({ name }) => name));
  const templateDir = path.join(rootDir, templateDirName);
  if (!fs.existsSync(templateDir)) return [];

  const { sites } = scanTreePins(templateDir, isEcosystemScopeName);
  const pinnedNames = new Set(sites.map(({ packageName }) => packageName));
  return ecosystem.filter(({ name }) => pinnedNames.has(name)).map(({ dir }) => dir);
}
