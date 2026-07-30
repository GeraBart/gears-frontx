// @cpt-algo:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2
//
// Closes the gap the manifest-CONTRACT check alone leaves open (see #493):
// `validate-contract.ts` validates the manifest's *declared* ownership
// boundaries, but nothing there inspects the *content* those boundaries own.
// A file inside a declared exclusive subtree can carry a filesystem-path
// reference that resolves outside the candidate template directory — a
// `package.json` `file:` specifier, a tsconfig `paths` mapping, or a lockfile
// workspace-member/`resolved` entry — and the contract check has no way to
// see it. This is exactly how the #485 escaping-`file:` bug class lived
// undetected through pre-publish validation.
//
// Generic by construction: every input here is the manifest's OWN declared
// exclusive subtrees and the candidate directory's own files. No template
// name, no file path, no site count is hardcoded, so this stays safe for
// `cpt-frontx-constraint-cli-template-independence` (CLI-1) — the check
// inspects whatever candidate it is pointed at and knows nothing else.
import type { ListSubtreeFilesFn, ManifestViolation, ManifestValidationResult, ReadFileFn } from './types';

// A path-like specifier a carrier file declares, plus the directory it is
// relative to (POSIX, itself relative to the template root — never an
// absolute filesystem path). Keeping both pieces of the resolution intact,
// rather than pre-resolving here, is what lets `resolvesOutsideRoot` work
// entirely in a virtual root-relative path space with no real fs calls.
interface PathSpecifier {
  description: string;
  rawPath: string;
  baseDir: string;
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

// @cpt-begin:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-for-each-carrier
// A file counts as a carrier only by name — not by directory — so a
// `package.json` nested arbitrarily deep inside a declared subtree (a
// workspace member, an MFE fixture) is inspected exactly like the template's
// root manifest.
type CarrierKind = 'package.json' | 'tsconfig' | 'lockfile';

function carrierKind(fileRelPath: string): CarrierKind | null {
  const base = fileRelPath.split('/').pop() ?? fileRelPath;
  if (base === 'package.json') return 'package.json';
  if (/^tsconfig(\..+)?\.json$/i.test(base)) return 'tsconfig';
  if (base === 'package-lock.json' || base === 'npm-shrinkwrap.json') return 'lockfile';
  return null;
}
// @cpt-end:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-for-each-carrier

function posixDirname(relPath: string): string {
  const segments = relPath.split('/');
  segments.pop();
  return segments.length === 0 ? '.' : segments.join('/');
}

function posixJoin(...segments: string[]): string {
  const joined = segments.filter((s) => s !== '' && s !== '.').join('/');
  return joined === '' ? '.' : joined;
}

// @cpt-begin:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-extract-specifiers
// `file:` dependency specifiers in `package.json` — relative to the manifest
// file's OWN directory (npm's own resolution rule for a `file:` range).
function extractPackageJsonSpecifiers(fileRelPath: string, parsed: unknown): PathSpecifier[] {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const obj = parsed as Record<string, unknown>;
  const baseDir = posixDirname(fileRelPath);
  const results: PathSpecifier[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const depMap = obj[field];
    if (typeof depMap !== 'object' || depMap === null || Array.isArray(depMap)) continue;
    for (const [name, value] of Object.entries(depMap as Record<string, unknown>)) {
      if (typeof value === 'string' && value.startsWith('file:')) {
        results.push({ description: `${field}["${name}"]`, rawPath: value.slice('file:'.length), baseDir });
      }
    }
  }
  return results;
}

// `compilerOptions.paths` mapping entries — relative to `baseUrl` (default
// `.`), which is itself relative to the tsconfig file's own directory, per
// TypeScript's own path-mapping resolution rule. A trailing wildcard segment
// (`"../packages/api/src/*"`) is stripped to its directory prefix: the
// algorithm only needs to know where the mapping POINTS, not the individual
// module names it will later match.
function extractTsconfigSpecifiers(fileRelPath: string, parsed: unknown): PathSpecifier[] {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const compilerOptions = (parsed as Record<string, unknown>)['compilerOptions'];
  if (typeof compilerOptions !== 'object' || compilerOptions === null || Array.isArray(compilerOptions)) return [];
  const co = compilerOptions as Record<string, unknown>;
  const baseUrl = typeof co['baseUrl'] === 'string' ? co['baseUrl'] : '.';
  const baseDir = posixJoin(posixDirname(fileRelPath), baseUrl);

  const paths = co['paths'];
  if (typeof paths !== 'object' || paths === null || Array.isArray(paths)) return [];
  const results: PathSpecifier[] = [];
  for (const [key, values] of Object.entries(paths as Record<string, unknown>)) {
    if (!Array.isArray(values)) continue;
    values.forEach((value, i) => {
      if (typeof value !== 'string') return;
      results.push({ description: `compilerOptions.paths["${key}"][${i}]`, rawPath: value.replace(/\*+$/, ''), baseDir });
    });
  }
  return results;
}

// A registry/VCS reference is never a local filesystem escape — only a bare
// (or `file:`-prefixed) relative path is a candidate for containment.
function isRegistryOrVcsReference(value: string): boolean {
  return /^(https?:|git\+|git:|github:|npm:)/i.test(value);
}

// Lockfile local-path carriers. Two lockfile shapes exist across npm
// versions (per #493's own "parse, don't grep" note), both handled here by
// STRUCTURE, not by scanning the raw text for `../`:
//  - lockfileVersion >= 2's flat `packages` map: a workspace/local-link
//    member's map KEY is itself its path relative to the lockfile's own
//    directory (never "" for the root, never under `node_modules/`); a
//    `node_modules/<name>` link entry's `resolved` field is likewise
//    relative to the lockfile's directory for a local link.
//  - lockfileVersion 1's legacy nested `dependencies` tree: a `file:`-pinned
//    entry's `version` (and/or `resolved`) field carries the local path.
function extractLockfileSpecifiers(fileRelPath: string, parsed: unknown): PathSpecifier[] {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const obj = parsed as Record<string, unknown>;
  const baseDir = posixDirname(fileRelPath);
  const results: PathSpecifier[] = [];

  const packages = obj['packages'];
  if (typeof packages === 'object' && packages !== null && !Array.isArray(packages)) {
    for (const [key, entry] of Object.entries(packages as Record<string, unknown>)) {
      if (key !== '' && !key.startsWith('node_modules/')) {
        results.push({ description: `packages["${key}"]`, rawPath: key, baseDir });
      }
      if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
        const resolved = (entry as Record<string, unknown>)['resolved'];
        if (typeof resolved === 'string' && !isRegistryOrVcsReference(resolved)) {
          const rawPath = resolved.startsWith('file:') ? resolved.slice('file:'.length) : resolved;
          results.push({ description: `packages["${key}"].resolved`, rawPath, baseDir });
        }
      }
    }
    return results;
  }

  // lockfileVersion 1 — `packages` is absent; walk the legacy nested tree.
  const legacyDeps = obj['dependencies'];
  if (typeof legacyDeps === 'object' && legacyDeps !== null && !Array.isArray(legacyDeps)) {
    collectLegacyLockEntries(legacyDeps as Record<string, unknown>, baseDir, results);
  }
  return results;
}

function collectLegacyLockEntries(deps: Record<string, unknown>, baseDir: string, results: PathSpecifier[]): void {
  for (const [name, entry] of Object.entries(deps)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const entryObj = entry as Record<string, unknown>;

    const version = entryObj['version'];
    if (typeof version === 'string' && version.startsWith('file:')) {
      results.push({ description: `dependencies["${name}"].version`, rawPath: version.slice('file:'.length), baseDir });
    }

    const resolved = entryObj['resolved'];
    if (typeof resolved === 'string' && !isRegistryOrVcsReference(resolved)) {
      const rawPath = resolved.startsWith('file:') ? resolved.slice('file:'.length) : resolved;
      results.push({ description: `dependencies["${name}"].resolved`, rawPath, baseDir });
    }

    const nested = entryObj['dependencies'];
    if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
      collectLegacyLockEntries(nested as Record<string, unknown>, baseDir, results);
    }
  }
}
// @cpt-end:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-extract-specifiers

// @cpt-begin:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-resolve-specifier
// Resolves `baseDir/rawPath` against the template root by working entirely
// in a virtual, root-relative POSIX path space (the template root is always
// "."; `baseDir` and `rawPath` are always relative to it) — never against a
// real absolute filesystem path. `..`-segment counting, not text matching,
// decides containment, so a benign `./foo/../bar` is not mistaken for an
// escape and a disguised escape is not missed.
function resolvesOutsideRoot(baseDir: string, rawPath: string): boolean {
  const combined = posixJoin(baseDir, rawPath);
  const segments: string[] = [];
  for (const segment of combined.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return true; // climbed past the template root itself
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return false;
}
// @cpt-end:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-resolve-specifier

// @cpt-begin:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-for-each-subtree
export async function validateContentSelfContainment(
  templateDir: string,
  manifestRaw: string,
  listSubtreeFiles: ListSubtreeFilesFn,
  readFile: ReadFileFn,
): Promise<ManifestValidationResult> {
  const exclusiveSubtrees = extractExclusiveSubtrees(manifestRaw);
  const violations: ManifestViolation[] = [];
  const seenFiles = new Set<string>();

  for (const subtreeEntry of exclusiveSubtrees) {
    // @cpt-begin:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-enumerate-files
    const files = await listSubtreeFiles(templateDir, subtreeEntry);
    // @cpt-end:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-enumerate-files
    // @cpt-end:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-for-each-subtree
    for (const fileRelPath of files) {
      // Overlapping subtree entries (a directory and a file beneath it) can
      // list the same file twice; a violation is reported once regardless.
      if (seenFiles.has(fileRelPath)) continue;
      seenFiles.add(fileRelPath);

      const kind = carrierKind(fileRelPath);
      if (kind === null) continue;

      let raw: string;
      try {
        raw = await readFile(`${templateDir}/${fileRelPath}`);
      } catch {
        continue; // vanished between listing and reading — not this check's concern
      }

      // @cpt-begin:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-parse-carrier
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue; // malformed JSON is the contract/build's concern, not duplicated here
      }
      // @cpt-end:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-parse-carrier

      const specifiers =
        kind === 'package.json'
          ? extractPackageJsonSpecifiers(fileRelPath, parsed)
          : kind === 'tsconfig'
            ? extractTsconfigSpecifiers(fileRelPath, parsed)
            : extractLockfileSpecifiers(fileRelPath, parsed);

      // @cpt-begin:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-for-each-specifier
      for (const specifier of specifiers) {
        // @cpt-begin:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-if-outside-root
        if (resolvesOutsideRoot(specifier.baseDir, specifier.rawPath)) {
          // @cpt-begin:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-add-violation
          violations.push({
            field: `${fileRelPath}:${specifier.description}`,
            message: `references "${specifier.rawPath}", which resolves outside the template root`,
          });
          // @cpt-end:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-add-violation
        }
        // @cpt-end:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-if-outside-root
      }
      // @cpt-end:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-for-each-specifier
    }
  }

  // @cpt-begin:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-if-violations
  if (violations.length > 0) {
    // @cpt-begin:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-return-rejected
    return { status: 'REJECTED', violations };
    // @cpt-end:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-return-rejected
  }
  // @cpt-end:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-if-violations

  // @cpt-begin:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-return-validated
  return { status: 'VALIDATED', violations: [] };
  // @cpt-end:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-return-validated
}

// Reads the manifest's OWN declared exclusive subtrees. Malformed input
// yields an empty list rather than throwing — the manifest CONTRACT check
// (`validate-contract.ts`) is the one authority for reporting a malformed
// manifest; this algorithm only runs at all once that check has already
// passed (see `commands/validate.ts`), so this is a defensive fallback, not
// a second contract enforcement path.
function extractExclusiveSubtrees(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const boundaries = (parsed as Record<string, unknown>)['ownershipBoundaries'];
  if (typeof boundaries !== 'object' || boundaries === null || Array.isArray(boundaries)) return [];
  const subtrees = (boundaries as Record<string, unknown>)['exclusiveSubtrees'];
  if (!Array.isArray(subtrees)) return [];
  return subtrees.filter((s): s is string => typeof s === 'string');
}
