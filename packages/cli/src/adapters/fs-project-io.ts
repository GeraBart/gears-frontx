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
import type { ListSubtreeFilesFn, ReadFileFn } from '../manifest/types';
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
 * Real `ListSubtreeFilesFn` — enumerates every regular file reachable under
 * one exclusive-subtree entry, POSIX-relative to `templateDir`. Never
 * descends into `node_modules` (install-time output, never committed
 * template content) or a dot-prefixed directory (the subtree entry itself
 * may legitimately be one, e.g. `.frontx/ai/<identity>` — only NESTED
 * dot-directories encountered while walking are skipped).
 */
export function createFsListSubtreeFilesFn(): ListSubtreeFilesFn {
  return async function listSubtreeFiles(templateDir: string, subtreeEntry: string): Promise<string[]> {
    const absoluteEntry = path.join(templateDir, subtreeEntry);
    if (!fs.existsSync(absoluteEntry)) return [];
    const stat = fs.statSync(absoluteEntry);
    if (stat.isFile()) return [toPosixPath(subtreeEntry)];
    if (!stat.isDirectory()) return [];
    return walkFiles(templateDir, subtreeEntry);
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
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...walkFiles(templateDir, relativePath));
    } else if (entry.isFile()) {
      files.push(toPosixPath(relativePath));
    }
  }
  return files;
}
