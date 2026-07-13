// @cpt-flow:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1
import { describe, it, expect } from 'vitest';
import { discoverAndActivateForInstalledTemplate, validateBundleForPublish } from '../discover-and-activate.js';
import type { BaseCapabilities } from '../scan.js';

function emptyBase(): BaseCapabilities {
  return new Map([
    ['skills', []],
    ['workflows', []],
    ['guidelines', []],
    ['reference_artifacts', []],
  ]);
}

describe('bundle-and-publish leg', () => {
  it('confirms conformance and allows publication for a fully-conforming bundle', () => {
    const bundle = [{ id: 'skill-1', category: 'skills', path: 'skills/skill-1.md' }];
    const result = validateBundleForPublish(bundle);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects publication when a declared entry names a category outside the closed set', () => {
    const bundle = [{ id: 'ext-1', category: 'mocks', path: 'mocks/ext-1.md' }];
    const result = validateBundleForPublish(bundle);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects publication when a declared entry omits a required structural element', () => {
    const bundle = [{ id: 'ext-1', category: 'skills' }];
    const result = validateBundleForPublish(bundle);
    expect(result.ok).toBe(false);
  });
});

describe('install-discover-activate leg', () => {
  it('installing a conforming template makes its extensions agent-visible with no manual configuration', () => {
    const bundle = [{ id: 'skill-1', category: 'skills', path: 'skills/skill-1.md' }];
    const result = discoverAndActivateForInstalledTemplate(bundle, emptyBase(), 0);
    expect(result.errors).toHaveLength(0);
    expect(result.composed.get('skills')?.get('skill-1')).toBeDefined();
  });

  it('a malformed entry on install is reported as a structural error and not activated', () => {
    const bundle = [{ id: 'broken', category: 'skills' }];
    const result = discoverAndActivateForInstalledTemplate(bundle, emptyBase(), 0);
    expect(result.errors).toHaveLength(1);
    expect(result.composed.get('skills')?.has('broken')).toBe(false);
  });

  it('discovery is parameterized over the contract: any conforming bundle is found regardless of namespace', () => {
    const bundleA = [{ id: 'acme-skill', category: 'skills', path: 'skills/acme-skill.md' }];
    const bundleB = [{ id: 'other-vendor-skill', category: 'skills', path: 'skills/other-vendor-skill.md' }];
    const resultA = discoverAndActivateForInstalledTemplate(bundleA, emptyBase(), 0);
    const resultB = discoverAndActivateForInstalledTemplate(bundleB, emptyBase(), 0);
    expect(resultA.composed.get('skills')?.get('acme-skill')).toBeDefined();
    expect(resultB.composed.get('skills')?.get('other-vendor-skill')).toBeDefined();
  });
});
