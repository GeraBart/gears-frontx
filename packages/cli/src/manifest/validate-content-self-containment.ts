// @cpt-algo:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2
//
// Closes the gap the manifest-CONTRACT check alone leaves open (see #493):
// `validate-contract.ts` validates the manifest's *declared* ownership
// boundaries, but nothing there inspects the *content* those boundaries own.
// A file inside a declared exclusive subtree OR shared-file path can carry a
// filesystem-path reference that resolves outside the candidate template
// directory — a `package.json` `file:` specifier; a tsconfig `paths`
// mapping, `extends` target, or `references[].path` entry; or a lockfile
// workspace-member/`resolved` entry — and the contract check has no way to
// see it. This is exactly how the #485 escaping-`file:` bug class lived
// undetected through pre-publish validation. The carrier set above is a
// registry, not a closed list: adding a carrier is a code change here, not a
// spec rewrite (deliberately excluded: `package.json` `workspaces` globs and
// any non-JSON carrier — this module parses structurally and never scans
// raw text).
//
// Generic by construction: every input here is the manifest's OWN declared
// content-owning paths (exclusive subtrees plus shared-file paths) and the
// candidate directory's own files. No template name, no file path, no site
// count is hardcoded, so this stays safe for
// `cpt-frontx-constraint-cli-template-independence` (CLI-1) — the check
// inspects whatever candidate it is pointed at and knows nothing else.
import type { ListContentOwnedFilesFn, ManifestViolation, ManifestValidationResult, ReadFileFn } from './types';

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
// `package.json` nested arbitrarily deep inside a declared content-owning
// path (a workspace member, an MFE fixture) is inspected exactly like the
// template's root manifest.
type CarrierKind = 'package.json' | 'tsconfig' | 'lockfile';

function carrierKind(fileRelPath: string): CarrierKind | null {
  const base = fileRelPath.split('/').pop() ?? fileRelPath;
  if (base === 'package.json') return 'package.json';
  if (/^tsconfig(\..+)?\.json$/i.test(base)) return 'tsconfig';
  if (base === 'package-lock.json' || base === 'npm-shrinkwrap.json') return 'lockfile';
  return null;
}
// @cpt-end:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-for-each-carrier

// Untrusted carrier JSON may spell a path with Windows separators (authored
// on Windows, or simply copied verbatim from a Windows machine) — a
// backslash-separated relative escape (`..\..\shared`) split ONLY on `/`
// survives as one opaque segment that never matches `..`, so the escape is
// missed entirely (CodeRabbit review finding on #493). Every path-arithmetic
// helper below normalizes to POSIX separators as its first step, so this is
// the one place backslash-vs-forward-slash is ever decided.
function toPosixSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

function posixDirname(relPath: string): string {
  const segments = toPosixSeparators(relPath).split('/');
  segments.pop();
  return segments.length === 0 ? '.' : segments.join('/');
}

function posixJoin(...segments: string[]): string {
  const joined = segments
    .map((s) => toPosixSeparators(s))
    .filter((s) => s !== '' && s !== '.')
    .join('/');
  return joined === '' ? '.' : joined;
}

// Every `baseDir`/`rawPath` this module resolves is CONTRACTUALLY relative to
// the template root (see `resolvesOutsideRoot` below) — the resolution never
// touches a real absolute filesystem path. An absolute POSIX path (`/...`), a
// Windows drive-prefixed path (`C:\...` or `C:/...`), or a home-relative path
// (`~` or `~/...`) therefore cannot BE root-relative, and is outside the
// root by definition, independent of `..`-segment counting. Real-world
// sources for exactly this shape: `npm install /abs/path` and `npm link`
// both write an absolute `file:` specifier into `package.json`, and a
// tsconfig `baseUrl` may itself be set to an absolute path.
const ABSOLUTE_OR_HOME_RELATIVE_RE = /^(\/|[A-Za-z]:\/|~(?:\/|$))/;

// Normalizes to POSIX separators first (`toPosixSeparators`) so this
// classifies a backslash-spelled value (`C:\repo`, `~\repo`) exactly like
// its forward-slash equivalent — one separator convention decides both this
// check and the segment-splitting `resolvesOutsideRoot` does below.
function isAbsoluteOrHomeRelative(value: string): boolean {
  return ABSOLUTE_OR_HOME_RELATIVE_RE.test(toPosixSeparators(value));
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

// A glob pattern (`include`/`exclude`) is cut at its first wildcard segment,
// leaving the directory prefix the pattern is ANCHORED at — which is the only
// part containment can be decided from, and the only part that carries an
// escape. Cutting rather than keeping the wildcard also stops a `**` segment
// from behaving like a real directory name that a later `..` could pop off.
function globAnchorPrefix(pattern: string): string {
  const segments: string[] = [];
  for (const segment of toPosixSeparators(pattern).split('/')) {
    if (/[*?]/.test(segment)) break;
    segments.push(segment);
  }
  return segments.join('/');
}

// Every path-like specifier a tsconfig file's own shape declares (A2 review
// finding on #493 widened this from `paths` alone to `extends` and
// `references[].path`; a CodeRabbit finding widened it again to the file-list
// and output fields — same file, same parse, same escape semantics).
// `paths` mapping entries resolve against `baseUrl` (default `.`); everything
// else here resolves against the tsconfig file's OWN directory instead, per
// TypeScript's own resolution rule for each.
function extractTsconfigSpecifiers(fileRelPath: string, parsed: unknown): PathSpecifier[] {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const obj = parsed as Record<string, unknown>;
  const tsconfigDir = posixDirname(fileRelPath);
  const results: PathSpecifier[] = [];

  const compilerOptions = obj['compilerOptions'];
  if (typeof compilerOptions === 'object' && compilerOptions !== null && !Array.isArray(compilerOptions)) {
    const co = compilerOptions as Record<string, unknown>;
    const rawBaseUrl = typeof co['baseUrl'] === 'string' ? co['baseUrl'] : '.';
    // An absolute/home-relative `baseUrl` REPLACES the tsconfig directory
    // entirely rather than being joined onto it (matching real path
    // resolution) — joining first would hide the escape inside a
    // concatenated string that no longer looks absolute (A1 review finding).
    const baseDir = isAbsoluteOrHomeRelative(rawBaseUrl) ? rawBaseUrl : posixJoin(tsconfigDir, rawBaseUrl);

    const paths = co['paths'];
    if (typeof paths === 'object' && paths !== null && !Array.isArray(paths)) {
      // A trailing wildcard segment (`"../packages/api/src/*"`) is stripped to
      // its directory prefix: the algorithm only needs to know where the
      // mapping POINTS, not the individual module names it will later match.
      for (const [key, values] of Object.entries(paths as Record<string, unknown>)) {
        if (!Array.isArray(values)) continue;
        values.forEach((value, i) => {
          if (typeof value !== 'string') return;
          results.push({ description: `compilerOptions.paths["${key}"][${i}]`, rawPath: value.replace(/\*+$/, ''), baseDir });
        });
      }
    }

    // `typeRoots` and `outDir` resolve against the tsconfig's OWN directory,
    // not `baseUrl` — an output directory or a type-root outside the template
    // makes the template's build depend on, or write into, a tree it does not
    // own.
    const typeRoots = co['typeRoots'];
    if (Array.isArray(typeRoots)) {
      typeRoots.forEach((value, i) => {
        if (typeof value !== 'string') return;
        results.push({ description: `compilerOptions.typeRoots[${i}]`, rawPath: value, baseDir: tsconfigDir });
      });
    }

    const outDir = co['outDir'];
    if (typeof outDir === 'string') {
      results.push({ description: 'compilerOptions.outDir', rawPath: outDir, baseDir: tsconfigDir });
    }
  }

  // The file lists: `files` is a plain path list (TypeScript forbids globs
  // there), `include`/`exclude` are glob patterns. All three resolve against
  // the tsconfig's own directory, and all three are how a tsconfig pulls
  // source files from outside the template into its own program — the same
  // escape a `paths` mapping expresses, spelled differently.
  const fileListFields: Array<{ field: 'files' | 'include' | 'exclude'; glob: boolean }> = [
    { field: 'files', glob: false },
    { field: 'include', glob: true },
    { field: 'exclude', glob: true },
  ];
  for (const { field, glob } of fileListFields) {
    const values = obj[field];
    if (!Array.isArray(values)) continue;
    values.forEach((value, i) => {
      if (typeof value !== 'string') return;
      const rawPath = glob ? globAnchorPrefix(value) : value;
      // A pattern anchored at the tsconfig's own directory (`**/*.ts`) cuts to
      // nothing — no path is being named, so there is nothing to contain.
      if (rawPath === '') return;
      results.push({ description: `${field}[${i}]`, rawPath, baseDir: tsconfigDir });
    });
  }

  // `extends` may be a single string or (TS 5.5+) an array of strings. A bare
  // package specifier (`"@tsconfig/node20/tsconfig.json"`) is npm-resolved,
  // not a filesystem reference — it never starts with `.`/`..`/`/`, so it can
  // never contain an escaping `..` segment and is harmless to leave unfiltered.
  const extendsValue = obj['extends'];
  const extendsList = typeof extendsValue === 'string' ? [extendsValue] : Array.isArray(extendsValue) ? extendsValue : [];
  extendsList.forEach((value, i) => {
    if (typeof value !== 'string') return;
    results.push({ description: `extends[${i}]`, rawPath: value, baseDir: tsconfigDir });
  });

  // `references[].path` — TS project references, each pointing at a sibling
  // project directory (or its tsconfig file directly) relative to this
  // tsconfig's own directory.
  const references = obj['references'];
  if (Array.isArray(references)) {
    references.forEach((entry, i) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return;
      const refPath = (entry as Record<string, unknown>)['path'];
      if (typeof refPath !== 'string') return;
      results.push({ description: `references[${i}].path`, rawPath: refPath, baseDir: tsconfigDir });
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
  // Checked independently, before combining: an absolute `baseDir` (e.g. an
  // absolute tsconfig `baseUrl`) or an absolute `rawPath` (e.g. an
  // `npm install`/`npm link`-written absolute `file:` specifier) each escape
  // on their own — joining first would corrupt the segment count instead of
  // rejecting outright (see A1 review finding on #493).
  if (isAbsoluteOrHomeRelative(baseDir) || isAbsoluteOrHomeRelative(rawPath)) return true;
  // `posixJoin` already normalizes each segment it's given; normalizing the
  // joined result again here is a deliberate belt-and-suspenders step right
  // at the split, so this line never again depends on every upstream caller
  // having normalized correctly (CodeRabbit review finding on #493).
  const combined = toPosixSeparators(posixJoin(baseDir, rawPath));
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
  listContentOwnedFiles: ListContentOwnedFilesFn,
  readFile: ReadFileFn,
): Promise<ManifestValidationResult> {
  const contentOwningPaths = extractDeclaredContentPaths(manifestRaw);
  const violations: ManifestViolation[] = [];
  const seenFiles = new Set<string>();

  for (const contentOwnedPath of contentOwningPaths) {
    // @cpt-begin:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2:inst-csc-enumerate-files
    const files = await listContentOwnedFiles(templateDir, contentOwnedPath);
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

// Reads the manifest's OWN declared content-owning paths: every exclusive
// subtree, PLUS every shared-file path (A3 review finding on #493). Either
// ownership-boundary kind can own a carrier file — after the #470 split,
// `package.json`/lockfile/tsconfig are expected to move to `sharedFiles` for
// at least one of the resulting templates (ADR-0031's own worked example),
// and enumerating `exclusiveSubtrees` alone would then silently stop
// inspecting the highest-value carriers. Malformed input yields an empty
// list rather than throwing — the manifest CONTRACT check
// (`validate-contract.ts`) is the one authority for reporting a malformed
// manifest; this algorithm only runs at all once that check has already
// passed (see `commands/validate.ts`), so this is a defensive fallback, not
// a second contract enforcement path.
function extractDeclaredContentPaths(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const boundaries = (parsed as Record<string, unknown>)['ownershipBoundaries'];
  if (typeof boundaries !== 'object' || boundaries === null || Array.isArray(boundaries)) return [];
  const boundariesObj = boundaries as Record<string, unknown>;

  const subtrees = boundariesObj['exclusiveSubtrees'];
  const exclusiveSubtrees = Array.isArray(subtrees)
    ? subtrees.filter((s): s is string => typeof s === 'string')
    : [];

  const sharedFiles = boundariesObj['sharedFiles'];
  const sharedFilePaths = Array.isArray(sharedFiles)
    ? sharedFiles
        .map((entry) =>
          typeof entry === 'object' && entry !== null && !Array.isArray(entry)
            ? (entry as Record<string, unknown>)['path']
            : undefined,
        )
        .filter((p): p is string => typeof p === 'string')
    : [];

  return [...exclusiveSubtrees, ...sharedFilePaths];
}
