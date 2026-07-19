// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
import fs from 'node:fs';
import path from 'node:path';
import type { ContentItem, ReadContentItemsFn } from '../scaffold/types';
import { resolveInstalledContentPath } from './fs-installed-content-path';

// The real `ReadContentItemsFn` implementation — per
// packages/cli/src/scaffold/types.ts: "the caller supplies the real
// implementation once the installed content path is materialized to disk".
// `FsContentStore` (fs-content-store.ts) is what materializes that path;
// this adapter reads every real file back out of it as content items, never
// from the manifest (cpt-frontx-algo-cli-scaffolding-uniform-apply inst-ua-read-content).
export function createFsReadContentItemsFn(root: string): ReadContentItemsFn {
  return async (entry) => {
    const installedPath = resolveInstalledContentPath(root, entry.name);
    if (!fs.existsSync(installedPath)) return [];
    return listContentItems(installedPath);
  };
}

function listContentItems(installedPath: string, relativeDir = ''): ContentItem[] {
  const absoluteDir = path.join(installedPath, relativeDir);
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const items: ContentItem[] = [];
  for (const dirEntry of entries) {
    const relativePath = path.join(relativeDir, dirEntry.name);
    if (dirEntry.isDirectory()) {
      items.push(...listContentItems(installedPath, relativePath));
    } else if (dirEntry.isFile()) {
      items.push({
        path: relativePath,
        content: fs.readFileSync(path.join(installedPath, relativePath), 'utf-8'),
      });
    }
  }
  return items;
}
