// Generic filesystem IO glue, plugged into the command surface at the F18
// executable entrypoint (`cli.ts`). These are thin fs wrappers behind seams
// the scaffolding (F12 `WriteFileFn`), manifest (F11 `ReadFileFn`), and
// upgrade (F14 `ReadProjectFileFn`/`WriteProjectFileFn`/`RemoveProjectFileFn`)
// FEATUREs already define — no template-resolution/inventory/provenance
// logic lives here (that is Phase 9/10's `adapters/fs-*` and
// `adapters/provenance-io.ts` scope). Pure IO plumbing, no business rule, no
// CDSL instruction of its own.
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
 * Real `ListContentOwnedFilesFn` — enumerates every regular file reachable
 * under one exclusive-subtree or shared-file entry, POSIX-relative to
 * `templateDir`. Never descends into `node_modules` (install-time output,
 * never committed template content). DOES descend into a dot-prefixed
 * directory and DOES include a dot-file: a template legitimately ships
 * dotfiles (`.gitignore`, its own `.frontx/ai/<identity>` bundle) as real
 * content, and a carrier nested under one (a `package.json` inside a hidden
 * directory) must still be inspected — skipping dot-prefixed entries would
 * open exactly the completeness hole the content self-containment check
 * exists to close (CodeRabbit review finding on #493).
 */
export function createFsListContentOwnedFilesFn(): ListContentOwnedFilesFn {
  return async function listContentOwnedFiles(templateDir: string, contentOwnedPath: string): Promise<string[]> {
    const absoluteEntry = path.join(templateDir, contentOwnedPath);
    if (!fs.existsSync(absoluteEntry)) return [];
    const stat = fs.statSync(absoluteEntry);
    if (stat.isFile()) return [toPosixPath(contentOwnedPath)];
    if (!stat.isDirectory()) return [];
    return walkFiles(templateDir, contentOwnedPath);
  };
}

function toPosixPath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function walkFiles(templateDir: string, relativeDir: string): string[] {
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
      files.push(...walkFiles(templateDir, relativePath));
    } else if (entry.isFile()) {
      files.push(toPosixPath(relativePath));
    }
  }
  return files;
}
