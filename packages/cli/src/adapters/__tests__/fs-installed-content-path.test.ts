// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { assertWithinRoot, resolveInstalledContentPath } from '../fs-installed-content-path';

describe('resolveInstalledContentPath', () => {
  // inst-resolve-write, inst-resolve-return — installed content path
  // addresses the template's actual on-disk files under the store root.
  it('joins the store root and the template name', () => {
    const result = resolveInstalledContentPath('/store', 'my-template');
    expect(result).toBe(path.join('/store', 'my-template'));
  });
});

describe('assertWithinRoot', () => {
  // inst-bupd-boundary-confirm — bounded-update writes exclusively within
  // the inventory store root.
  it('does not throw for a path within the root', () => {
    expect(() => assertWithinRoot('/store', '/store/my-template/file.txt')).not.toThrow();
  });

  it('throws for a path escaping the root via a parent segment', () => {
    expect(() => assertWithinRoot('/store', '/store/../outside/file.txt')).toThrow(
      /outside inventory store root/,
    );
  });

  it('throws for an unrelated absolute path', () => {
    expect(() => assertWithinRoot('/store', '/etc/passwd')).toThrow(/outside inventory store root/);
  });
});
