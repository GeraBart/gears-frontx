// Generic filesystem IO glue, plugged into the command surface at the F18
// executable entrypoint (`cli.ts`). These are thin fs wrappers behind seams
// the scaffolding (F12 `WriteFileFn`), manifest (F11 `ReadFileFn`), and
// upgrade (F14 `ReadProjectFileFn`/`WriteProjectFileFn`/`RemoveProjectFileFn`)
// FEATUREs already define — no template-resolution/inventory/provenance
// logic lives here (that is Phase 9/10's `adapters/fs-*` and
// `adapters/provenance-io.ts` scope). Not pure IO plumbing throughout,
// though: `createFsListContentOwnedFilesFn` below enumerates the content it
// finds but refuses a declared boundary it cannot honestly enumerate,
// rather than reporting one as an empty list — see its doc comment.
import fs from 'node:fs';
import path from 'node:path';
import type { WriteFileFn } from '../scaffold/types';
import type { ListContentOwnedFilesFn, ReadFileFn } from '../manifest/types';
import type { ReadProjectFileFn, WriteProjectFileFn, RemoveProjectFileFn } from '../upgrade/types';

/** Real `WriteFileFn` — writes a destination file, creating parent dirs. */
export function createFsWriteFileFn(): WriteFileFn {
  return async function writeFile(destPath: string, content: string): Promise<void> {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content, 'utf-8');
  };
}

/** Real `ReadFileFn` — reads a manifest file; throws (per the seam contract) when absent. */
export function createFsReadFileFn(): ReadFileFn {
  return async function readFile(filePath: string): Promise<string> {
    return fs.readFileSync(filePath, 'utf-8');
  };
}

/** Real `ReadProjectFileFn` — returns `null` (never throws) when the file is absent. */
export function createFsReadProjectFileFn(): ReadProjectFileFn {
  return async function readProjectFile(absolutePath: string): Promise<string | null> {
    if (!fs.existsSync(absolutePath)) return null;
    return fs.readFileSync(absolutePath, 'utf-8');
  };
}

/** Real `WriteProjectFileFn` — writes an absolute project file, creating parent dirs. */
export function createFsWriteProjectFileFn(): WriteProjectFileFn {
  return async function writeProjectFile(absolutePath: string, content: string): Promise<void> {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf-8');
  };
}

/** Real `RemoveProjectFileFn` — removes an absolute project file; no-op when absent. */
export function createFsRemoveProjectFileFn(): RemoveProjectFileFn {
  return async function removeProjectFile(absolutePath: string): Promise<void> {
    if (fs.existsSync(absolutePath)) {
      fs.rmSync(absolutePath, { force: true });
    }
  };
}

/**
 * Real `ListContentOwnedFilesFn` - enumerates every regular file reachable
 * under one exclusive-subtree or shared-file entry, POSIX-relative to
 * `templateDir`. Never descends into `node_modules` (install-time output,
 * never committed template content). DOES descend into a dot-prefixed
 * directory and DOES include a dot-file: a template legitimately ships
 * dotfiles (`.gitignore`, its own `.frontx/ai/<identity>` bundle) as real
 * content, and a carrier nested under one (a `package.json` inside a hidden
 * directory) must still be inspected - skipping dot-prefixed entries would
 * open exactly the completeness hole the content self-containment check
 * exists to close (CodeRabbit review finding on #493).
 *
 * A SYMLINK is resolved, not skipped. `readdirSync(..., { withFileTypes:
 * true })` reports a symlink's own type, for which `isDirectory()` and
 * `isFile()` are BOTH false, so a symlinked carrier - or a whole symlinked
 * directory of them - used to be silently dropped from the enumeration and
 * therefore never inspected (CodeRabbit review finding on #493). What the
 * link POINTS at decides, via `statSync`, which follows it.
 *
 * A resolved symlink found WHILE walking must not take the walk outside the
 * template: a link to `../../shared` is exactly the escape this check exists
 * to catch, and walking into it would report files that are not the
 * template's content as if they were. Such a mid-walk link is skipped - its
 * existence as an escape is the CONTENT check's business only in so far as a
 * carrier declares it, and for content it FINDS this adapter enumerates rather
 * than judges. A template shipping an internal dangling or escaping link
 * alongside real content still enumerates that content.
 *
 * Two failures are refused outright rather than reported as an empty list.
 * First, a `readdir`/`stat` the operating system REFUSES (a permission-denied
 * directory, most of all): the seam's return type is `Promise<string[]>`, so
 * the only value this function could invent for "I could not enumerate" is an
 * empty list - which the content check cannot tell apart from a subtree that is
 * genuinely clean, and a validation gate that passes because it could not look
 * is worse than one that crashes. Second, the DECLARED boundary itself failing
 * to hold: the manifest names a content-owning path that is absent, is a broken
 * symlink, cannot be resolved, or resolves outside the template root.
 * Enumerating nothing there would certify content that was never inspected, so
 * each is thrown with a message naming the refused path. This is the declared
 * entry ONLY; the mid-walk skip above is unchanged. Every throw is converted
 * into a named failure result exactly once, at the command boundary that owns
 * the exit code (`commands/validate.ts`), which is where the manifest read's
 * own failure is already turned into one.
 */
export function createFsListContentOwnedFilesFn(): ListContentOwnedFilesFn {
  return async function listContentOwnedFiles(templateDir: string, contentOwnedPath: string): Promise<string[]> {
    const absoluteEntry = path.join(templateDir, contentOwnedPath);
    // `existsSync` follows the link, so a broken symlink reads as absent too;
    // either way the declared boundary cannot be enumerated and is refused.
    if (!fs.existsSync(absoluteEntry)) {
      throw new Error(`declared content-owning path does not exist: ${contentOwnedPath}`);
    }

    // The declared entry itself may be a symlink; `templateDir` may sit under
    // one too (a macOS `/tmp` -> `/private/tmp` prefix is the everyday case).
    // Both sides are resolved so containment compares like with like.
    const root = realPathOrNull(templateDir);
    if (root === null) {
      throw new Error(`template directory could not be resolved: ${templateDir}`);
    }
    const resolvedEntry = realPathOrNull(absoluteEntry);
    if (resolvedEntry === null) {
      throw new Error(`declared content-owning path could not be resolved: ${contentOwnedPath}`);
    }
    // A declared boundary resolving outside the template root would enumerate
    // files that are not the template's content; the escape is refused here.
    // (A mid-walk escape is skipped instead - see walkFiles.)
    if (!isInside(root, resolvedEntry)) {
      throw new Error(`declared content-owning path resolves outside the template root: ${contentOwnedPath} -> ${resolvedEntry}`);
    }

    const stat = fs.statSync(absoluteEntry);
    if (stat.isFile()) return [toPosixPath(contentOwnedPath)];
    if (!stat.isDirectory()) return [];
    return walkFiles(templateDir, contentOwnedPath, root, new Set([resolvedEntry]));
  };
}

function toPosixPath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

/** `null` for a broken symlink or a path that vanished mid-walk. */
function realPathOrNull(absolutePath: string): string | null {
  try {
    return fs.realpathSync(absolutePath);
  } catch {
    return null;
  }
}

function isInside(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  return candidate.startsWith(root + path.sep);
}

/**
 * @param visitedRealDirs real paths of directories already entered. Only a
 *   symlink can make this walk cycle (a plain directory tree cannot contain
 *   itself), and a link back to an ancestor would otherwise recurse forever.
 */
function walkFiles(
  templateDir: string,
  relativeDir: string,
  root: string,
  visitedRealDirs: Set<string>,
): string[] {
  const absoluteDir = path.join(templateDir, relativeDir);
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    // node_modules is the ONE exclusion: install-time output, never
    // committed template content. A dot-prefixed entry is ordinary content
    // (see the doc comment above) and is walked/included like any other.
    if (entry.name === 'node_modules') continue;
    const relativePath = `${relativeDir}/${entry.name}`;

    if (entry.isDirectory()) {
      files.push(...walkFiles(templateDir, relativePath, root, visitedRealDirs));
      continue;
    }
    if (entry.isFile()) {
      files.push(toPosixPath(relativePath));
      continue;
    }
    if (!entry.isSymbolicLink()) continue; // fifo, socket, device: not content

    const resolved = realPathOrNull(path.join(absoluteDir, entry.name));
    if (resolved === null) continue; // broken link
    if (!isInside(root, resolved)) continue; // points outside the template
    if (visitedRealDirs.has(resolved)) continue; // already walked through another path

    const targetStat = fs.statSync(resolved);
    if (targetStat.isDirectory()) {
      visitedRealDirs.add(resolved);
      files.push(...walkFiles(templateDir, relativePath, root, visitedRealDirs));
    } else if (targetStat.isFile()) {
      files.push(toPosixPath(relativePath));
    }
  }
  return files;
}
