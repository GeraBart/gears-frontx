// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
// Host-app Vitest config: owns `template-standard/src-app/` (everything under
// this directory) except nested MFE packages, which own their own Vitest
// configs and are orchestrated as separate projects. Covering all of this
// directory here means any future host-side folder (for example a new
// top-level `shared/`) is picked up automatically instead of being silently
// skipped.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import {
  COVERAGE_EXCLUDE,
  COVERAGE_THRESHOLDS,
  DEFAULT_TEST_EXCLUDE,
  SHARED_VITEST_SETUP_FILES,
  VITE_RESOLVE_DEDUPE,
  VITEST_SERVER_DEPS_INLINE,
  vitestNodeWorkerExecArgv,
} from '../vitest.shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  // `vitest.setup.ts` lives at the real repo root (shared with ecosystem
  // package tests, e.g. packages/api) — two levels up from this config's own
  // directory. Vite's dev-server file-serving restriction otherwise blocks
  // reading it via `/@fs/...` outside the default project-root boundary.
  server: {
    fs: {
      allow: [path.resolve(__dirname, '../..')],
    },
  },
  resolve: {
    alias: [
      {
        find: '@gears-frontx/react/testing',
        replacement: path.resolve(__dirname, '../packages/framework/dist/testing.js'),
      },
      {
        find: '@frontx-test-utils',
        replacement: path.resolve(__dirname, './__test-utils__'),
      },
      {
        find: '@',
        replacement: __dirname,
      },
    ],
    dedupe: [...VITE_RESOLVE_DEDUPE],
  },
  test: {
    globals: true,
    passWithNoTests: false,
    environment: 'jsdom',
    execArgv: vitestNodeWorkerExecArgv(),
    setupFiles: [...SHARED_VITEST_SETUP_FILES],
    include: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    exclude: ['mfe_packages/**', ...DEFAULT_TEST_EXCLUDE],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [...COVERAGE_EXCLUDE],
      thresholds: { ...COVERAGE_THRESHOLDS },
    },
    server: {
      deps: {
        inline: [...VITEST_SERVER_DEPS_INLINE],
      },
    },
  },
});
