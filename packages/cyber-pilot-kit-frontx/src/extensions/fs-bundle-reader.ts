// @cpt-algo:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import type { BundleFsReader } from './fs-discovery.js';

/**
 * Production `BundleFsReader`: reads the AI-extension bundle straight off
 * disk. Mirrors the kit's `createFsResourceBodyReader` DI shape so the fs
 * discovery algorithm (`discoverExtensionBundleFromFs`) stays testable
 * without touching real disk in unit tests.
 */
export function createFsBundleReader(): BundleFsReader {
  return {
    readFile(path: string): string | undefined {
      if (!existsSync(path) || !statSync(path).isFile()) return undefined;
      return readFileSync(path, 'utf-8');
    },
    listDir(path: string): string[] | undefined {
      if (!existsSync(path) || !statSync(path).isDirectory()) return undefined;
      return readdirSync(path).filter((name) => statSync(`${path}/${name}`).isDirectory());
    },
  };
}
