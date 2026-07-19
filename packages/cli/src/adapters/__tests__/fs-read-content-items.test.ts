// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { createFsReadContentItemsFn } from '../fs-read-content-items';
import { FsContentStore } from '../fs-content-store';
import { InventoryState } from '../../inventory/types';
import { MANIFEST_FILENAME } from '../../manifest/types';

describe('createFsReadContentItemsFn', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-fs-read-content-items-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  // inst-ua-read-content — reads content items directly from the installed
  // content path on disk, never from the manifest.
  it('reads every materialized file as a content item', () => {
    const store = new FsContentStore(root);
    store.write(
      'my-template',
      JSON.stringify({
        $frontxTemplateFiles: {
          [MANIFEST_FILENAME]: '{"name":"my-template"}',
          'src/index.ts': 'export const x = 1;',
        },
      }),
    );

    const readContentFn = createFsReadContentItemsFn(root);
    const items = readContentFn({
      name: 'my-template',
      source: 'github:acme/my-template@v1.0.0',
      ref: 'v1.0.0',
      status: InventoryState.INSTALLED,
      content: '{"name":"my-template"}',
    });

    return items.then((resolved) => {
      const byPath = new Map(resolved.map((item) => [item.path, item.content]));
      expect(byPath.get(MANIFEST_FILENAME)).toBe('{"name":"my-template"}');
      expect(byPath.get('src/index.ts')).toBe('export const x = 1;');
    });
  });

  it('returns an empty array when the template was never materialized', async () => {
    const readContentFn = createFsReadContentItemsFn(root);
    const items = await readContentFn({
      name: 'nonexistent',
      source: '',
      ref: '',
      status: InventoryState.UNRESOLVED,
      content: '',
    });
    expect(items).toEqual([]);
  });
});
