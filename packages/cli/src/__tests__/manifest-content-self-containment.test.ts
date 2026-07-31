// @cpt-algo:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2
// @cpt-dod:cpt-frontx-dod-template-manifest-content-self-containment:p2
import { describe, it, expect } from 'vitest';
import { validateContentSelfContainment } from '../manifest/validate-content-self-containment';
import type { ListContentOwnedFilesFn, ReadFileFn } from '../manifest/types';

// Builds a fake in-memory candidate template: `files` maps a POSIX-relative
// path to its raw text content. `listContentOwnedFiles` returns every fixture
// path that falls under the requested content-owning path (directory prefix
// match, or exact match for a single-file entry) - a minimal stand-in for
// the real fs walk (`createFsListContentOwnedFilesFn`) that keeps these
// tests independent of any real filesystem.
function fakeTemplate(files: Record<string, string>): { listContentOwnedFiles: ListContentOwnedFilesFn; readFile: ReadFileFn } {
  const listContentOwnedFiles: ListContentOwnedFilesFn = async (_templateDir, contentOwnedPath) => {
    return Object.keys(files).filter((f) => f === contentOwnedPath || f.startsWith(`${contentOwnedPath}/`));
  };
  const readFile: ReadFileFn = async (path) => {
    const relative = path.startsWith('template/') ? path.slice('template/'.length) : path;
    const content = files[relative];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  };
  return { listContentOwnedFiles, readFile };
}

function manifest(exclusiveSubtrees: string[], sharedFilePaths: string[] = []): string {
  return JSON.stringify({
    name: 'my-tpl',
    version: '1.0.0',
    ownershipBoundaries: {
      exclusiveSubtrees,
      sharedFiles: sharedFilePaths.map((path) => ({ path, mergeStrategy: 'exclusive', ownedRegions: [] })),
    },
  });
}

describe('validateContentSelfContainment - package.json `file:` specifiers', () => {
  // inst-csc-extract-specifiers / inst-csc-resolve-specifier / inst-csc-if-outside-root
  it('a `file:` specifier resolving outside the template root is a violation', async () => {
    // Mirrors #485's actual escape: `packages/framework/package.json` sits
    // two levels below the template root, so three `..` segments overshoot
    // the root by exactly one level.
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/package.json': JSON.stringify({
        devDependencies: { '@gears-frontx/mfes': 'file:../../../packages/mfes' },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['packages']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.field).toContain('packages/framework/package.json');
  });

  // false-positive guard (#485's "stays inside" class) - a relative `file:`
  // specifier that stays inside the template root is legitimate, not flagged.
  it("a `file:` specifier resolving to the template's own subpackage is NOT a violation", async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'src-app/mfe_packages/blank/package.json': JSON.stringify({
        dependencies: { '@gears-frontx/react': 'file:../../../packages/react' },
      }),
      'packages/react/package.json': JSON.stringify({ name: '@gears-frontx/react', version: '0.2.0' }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['src-app', 'packages']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('VALIDATED');
  });

  it('a root-level package.json declared as its own exclusiveSubtrees entry is inspected', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package.json': JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:../packages/api' } }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
  });
});

describe('validateContentSelfContainment - absolute / drive-prefixed / home-relative specifiers (A1)', () => {
  // Every specifier this algorithm resolves is CONTRACTUALLY root-relative;
  // an absolute, drive-prefixed, or home-relative value can never actually
  // be root-relative, so it is outside the root by definition regardless of
  // `..`-segment counting. Real-world source: `npm install /abs/path` and
  // `npm link` both write an absolute `file:` specifier.
  it('an absolute POSIX `file:` specifier is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package.json': JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:/Users/me/monorepo/packages/api' } }),
    });
    const result = await validateContentSelfContainment('template', manifest(['package.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
  });

  it('a Windows drive-prefixed `file:` specifier is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package.json': JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:C:\\repo\\packages\\api' } }),
    });
    const result = await validateContentSelfContainment('template', manifest(['package.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
  });

  it('a home-relative (`~`) `file:` specifier is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package.json': JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:~/repo/packages/api' } }),
    });
    const result = await validateContentSelfContainment('template', manifest(['package.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
  });

  it('an absolute `compilerOptions.baseUrl` is a violation, even for an otherwise in-root `paths` entry', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '/Users/me/monorepo/template-standard', paths: { '@gears-frontx/state': ['./packages/state/src/index.ts'] } },
      }),
    });
    const result = await validateContentSelfContainment('template', manifest(['tsconfig.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
  });
});

describe('validateContentSelfContainment - backslash / mixed-separator specifiers (CodeRabbit review)', () => {
  // `resolvesOutsideRoot` splits on `/` to count `..` segments; a
  // backslash-separated relative escape written by a Windows author (or
  // pasted from a Windows machine) must not survive as one opaque, non-`..`
  // segment. Mirrors the same escaping depth used throughout this suite:
  // `packages/framework/package.json` sits two levels below the root, so
  // three ascending segments overshoot by exactly one, regardless of which
  // separator spells them.
  it('a relative backslash traversal in a `file:` specifier is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/package.json': JSON.stringify({
        devDependencies: { '@gears-frontx/mfes': 'file:..\\..\\..\\packages\\mfes' },
      }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
  });

  it('a relative backslash traversal in a tsconfig `paths` entry is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/tsconfig.json': JSON.stringify({
        compilerOptions: { paths: { '@gears-frontx/mfes': ['..\\..\\..\\packages\\mfes\\src'] } },
      }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
  });

  it('a mixed forward-slash/backslash traversal is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/package.json': JSON.stringify({
        devDependencies: { '@gears-frontx/mfes': 'file:../..\\../packages/mfes' },
      }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
  });

  it('a backslash-separated reference that still stays inside the template root is NOT a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'src-app/mfe_packages/blank/package.json': JSON.stringify({
        dependencies: { '@gears-frontx/react': 'file:..\\..\\..\\packages\\react' },
      }),
      'packages/react/package.json': JSON.stringify({ name: '@gears-frontx/react', version: '0.2.0' }),
    });
    const result = await validateContentSelfContainment('template', manifest(['src-app', 'packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('VALIDATED');
  });
});

describe('validateContentSelfContainment - tsconfig `paths` mappings', () => {
  // inst-csc-extract-specifiers (tsconfig) / inst-csc-resolve-specifier
  it('a `paths` entry resolving outside the template root is a violation, wildcard included', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.app.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@gears-frontx/api/*': ['../packages/api/src/*'] },
        },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['tsconfig.app.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations[0]?.field).toContain('compilerOptions.paths');
  });

  it('a `paths` entry resolving inside the template root (own subpackage) is NOT a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.app.json': JSON.stringify({
        compilerOptions: { paths: { '@gears-frontx/state': ['./packages/state/src/index.ts'] } },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['tsconfig.app.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('VALIDATED');
  });

  it('respects a non-default `baseUrl` when resolving a `paths` entry', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/react/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '..', paths: { '@gears-frontx/state': ['./state/src/index.ts'] } },
      }),
      'packages/state/src/index.ts': 'export {};',
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['packages']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('VALIDATED');
  });

  // A2 review finding - `extends` and `references[].path` are carriers with
  // the same escape semantics as `paths`, resolved relative to the
  // tsconfig's own directory (not `baseUrl`).
  it('an `extends` target escaping the template root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/tsconfig.json': JSON.stringify({ extends: '../../../tsconfig.base.json' }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations[0]?.field).toContain('extends[0]');
  });

  it('a bare-package `extends` target (npm-resolved, not a filesystem path) is NOT a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.json': JSON.stringify({ extends: '@tsconfig/node20/tsconfig.json' }),
    });
    const result = await validateContentSelfContainment('template', manifest(['tsconfig.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('VALIDATED');
  });

  it('a `references[].path` entry escaping the template root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/tsconfig.json': JSON.stringify({ references: [{ path: '../../../other-repo/shared' }] }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations[0]?.field).toContain('references[0].path');
  });

  it('a `references[].path` entry resolving to a sibling package inside the template root is NOT a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/tsconfig.json': JSON.stringify({ references: [{ path: '../state' }] }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('VALIDATED');
  });

  // CodeRabbit review finding on #493: `files`/`include`/`exclude` and
  // `compilerOptions.typeRoots`/`outDir` name paths too. `include` is the
  // sharpest of them - it is how a tsconfig pulls source files from outside the
  // template straight into its own program, which is the same escape a `paths`
  // mapping expresses with a different spelling.
  it('an `include` glob anchored outside the template root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/tsconfig.json': JSON.stringify({ include: ['src/**/*', '../../../shared/**/*'] }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.field).toContain('include[1]');
  });

  it('a `files` entry escaping the template root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.json': JSON.stringify({ files: ['src/index.ts', '../global.d.ts'] }),
    });
    const result = await validateContentSelfContainment('template', manifest(['tsconfig.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations[0]?.field).toContain('files[1]');
  });

  it('an `exclude` pattern escaping the template root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.json': JSON.stringify({ exclude: ['node_modules', '../dist'] }),
    });
    const result = await validateContentSelfContainment('template', manifest(['tsconfig.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations[0]?.field).toContain('exclude[1]');
  });

  it('a `typeRoots` or `outDir` outside the template root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { typeRoots: ['./types', '../../shared-types'], outDir: '../build' },
      }),
    });
    const result = await validateContentSelfContainment('template', manifest(['tsconfig.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.map((v) => v.field).join(' ')).toContain('compilerOptions.typeRoots[1]');
    expect(result.violations.map((v) => v.field).join(' ')).toContain('compilerOptions.outDir');
  });

  // False-positive guard, and the reason globs are cut at their first wildcard
  // rather than counted as path segments: every tsconfig the real templates
  // ship looks like this, and none of it names anything outside the root.
  it('the ordinary in-template file-list shapes are NOT violations', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.json': JSON.stringify({
        include: ['src/**/*'],
        exclude: ['node_modules', 'dist', '**/__tests__/**', '**/*.test.ts'],
        compilerOptions: { outDir: './dist', typeRoots: ['./node_modules/@types'] },
      }),
      // `rootDir: '../..'` climbs exactly to the template root, no further.
      'packages/react/tsconfig.test.json': JSON.stringify({
        include: ['src/**/*', '__tests__/**/*'],
        compilerOptions: { rootDir: '../..' },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['tsconfig.json', 'packages']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('VALIDATED');
  });
});

describe('validateContentSelfContainment - lockfile entries', () => {
  // inst-csc-extract-specifiers (lockfile, lockfileVersion >= 2 "packages" map)
  it('a lockfileVersion-3 workspace-member key escaping the template root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: { '': { name: 'tpl' }, '../packages/api': { name: '@gears-frontx/api', version: '0.3.0' } },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package-lock.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations[0]?.field).toContain('packages["../packages/api"]');
  });

  it('a lockfileVersion-3 `node_modules/*` link entry\'s escaping `resolved` value is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: { 'node_modules/@gears-frontx/api': { resolved: '../packages/api', link: true } },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package-lock.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
  });

  it('a workspace-member key/resolved value that stays inside the template root is NOT a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'packages/auth': { name: '@gears-frontx/auth', version: '0.2.0' },
          'node_modules/@gears-frontx/auth': { resolved: 'packages/auth', link: true },
        },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package-lock.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('VALIDATED');
  });

  it('a registry `resolved` URL is never mistaken for a local-path escape', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/esbuild': {
            version: '0.19.12',
            resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.19.12.tgz',
          },
        },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package-lock.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('VALIDATED');
  });

  // inst-csc-extract-specifiers (lockfile, legacy lockfileVersion 1 nested tree)
  it('a legacy lockfileVersion-1 `file:`-pinned nested entry escaping the root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package-lock.json': JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          '@gears-frontx/api': { version: 'file:../packages/api' },
        },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package-lock.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
  });
});

describe('validateContentSelfContainment - carrier discovery and edge cases', () => {
  it('no declared exclusive subtrees → VALIDATED trivially', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({});
    const result = await validateContentSelfContainment('template', manifest([]), listContentOwnedFiles, readFile);
    expect(result.status).toBe('VALIDATED');
  });

  it('a non-carrier file (e.g. a source .ts file) is never inspected', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'src/index.ts': 'import x from "../../../outside"; export default x;',
    });
    const result = await validateContentSelfContainment('template', manifest(['src']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('VALIDATED');
  });

  it('a malformed (unparseable) carrier file is skipped rather than crashing the check', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({ 'package.json': 'not-valid-json{{{' });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('VALIDATED');
  });

  it('multiple violations across multiple carriers are all reported', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package.json': JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:../packages/api' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@gears-frontx/mfes': ['../packages/mfes/src'] } } }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package.json', 'tsconfig.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations).toHaveLength(2);
  });

  // A3 review finding - ADR-0031's own worked example puts
  // package.json/lockfile/tsconfig in `sharedFiles`. No template ships that
  // shape yet (both post-#470 templates declare them as exclusive subtrees),
  // which is exactly why this needs a test: enumeration must not silently stop
  // covering the highest-value carriers the first time one does.
  it('a carrier declared only as a shared-file path (not an exclusive subtree) is still inspected', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package.json': JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:../packages/api' } }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest([], ['package.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
  });

  it('a carrier declared as both an exclusive subtree and a shared-file path is inspected once, not double-reported', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package.json': JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:../packages/api' } }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package.json'], ['package.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations).toHaveLength(1);
  });
});
