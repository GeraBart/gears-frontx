// @cpt-algo:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1
import { describe, it, expect } from 'vitest';
import { validateKitManifest } from '../validate-manifest.js';
import type { KitManifest } from '../types.js';

function validManifest(overrides: Partial<KitManifest> = {}): KitManifest {
  const base: KitManifest = {
    manifest: { version: '0.1.0', name: 'cyber-pilot-kit-frontx', description: 'FrontX AI Tooling Kit' },
    resources: [
      { id: 'frontx_skill', source: 'SKILL.md', default_path: 'SKILL.md', type: 'file', user_modifiable: false },
    ],
  };
  return { ...base, ...overrides };
}

describe('validateKitManifest', () => {
  // inst-check-required-fields
  it('missing manifest section → FAIL required-fields violation', () => {
    const result = validateKitManifest({ resources: [] } as unknown as KitManifest);
    expect(result.status).toBe('FAIL');
    expect(result.violations.some((v) => v.field === 'manifest')).toBe(true);
  });

  // inst-check-version
  it('missing manifest.version → FAIL version violation', () => {
    const m = validManifest({ manifest: { name: 'kit', description: '' } } as unknown as KitManifest);
    const result = validateKitManifest(m);
    expect(result.status).toBe('FAIL');
    expect(result.violations.some((v) => v.field === 'manifest.version')).toBe(true);
  });

  // inst-check-resources-array
  it('empty resources array → FAIL resources-array violation', () => {
    const result = validateKitManifest(validManifest({ resources: [] }));
    expect(result.status).toBe('FAIL');
    expect(result.violations.some((v) => v.field === 'resources')).toBe(true);
  });

  // inst-check-entry-required — missing id
  it('resource entry missing id → FAIL entry-required violation', () => {
    const m = validManifest({
      resources: [{ source: 'SKILL.md', default_path: 'SKILL.md', type: 'file' } as unknown as KitManifest['resources'][0]],
    });
    const result = validateKitManifest(m);
    expect(result.status).toBe('FAIL');
    expect(result.violations.some((v) => v.field === 'resources[0].id')).toBe(true);
  });

  // inst-check-frontx-prefix / inst-if-prefix-fail / inst-record-prefix-violation
  it('resource id without frontx_ prefix → FAIL prefix violation', () => {
    const m = validManifest({
      resources: [{ id: 'skills_main', source: 'SKILL.md', default_path: 'SKILL.md', type: 'file', user_modifiable: false }],
    });
    const result = validateKitManifest(m);
    expect(result.status).toBe('FAIL');
    expect(result.violations.some((v) => v.field === 'resources[0].id' && v.code === 'MISSING_FRONTX_PREFIX')).toBe(true);
  });

  // inst-check-type-enum
  it('resource type not file or directory → FAIL type-enum violation', () => {
    const m = validManifest({
      resources: [{ id: 'frontx_skill', source: 'SKILL.md', default_path: 'SKILL.md', type: 'link' as 'file', user_modifiable: false }],
    });
    const result = validateKitManifest(m);
    expect(result.status).toBe('FAIL');
    expect(result.violations.some((v) => v.field === 'resources[0].type')).toBe(true);
  });

  // inst-scan-solution-content / inst-if-solution-content / inst-record-solution-violation
  it('resource id naming solution-specific concept → FAIL solution-content violation', () => {
    const m = validManifest({
      resources: [{ id: 'frontx_react_template_skill', source: 'SKILL.md', default_path: 'SKILL.md', type: 'file', user_modifiable: false }],
    });
    const result = validateKitManifest(m);
    expect(result.status).toBe('FAIL');
    expect(result.violations.some((v) => v.code === 'SOLUTION_SPECIFIC_CONTENT')).toBe(true);
  });

  // inst-return-pass
  it('valid manifest with frontx_ prefix → PASS', () => {
    const result = validateKitManifest(validManifest());
    expect(result.status).toBe('PASS');
    expect(result.violations).toHaveLength(0);
  });

  it('multiple valid frontx_ resources → PASS', () => {
    const m = validManifest({
      resources: [
        { id: 'frontx_skill', source: 'SKILL.md', default_path: 'SKILL.md', type: 'file', user_modifiable: false },
        { id: 'frontx_agents', source: 'AGENTS.md', default_path: 'AGENTS.md', type: 'file', user_modifiable: false },
        { id: 'frontx_guidelines', source: 'guidelines/', default_path: 'guidelines/', type: 'directory', user_modifiable: true },
      ],
    });
    const result = validateKitManifest(m);
    expect(result.status).toBe('PASS');
  });

  // inst-if-violations / inst-return-fail — multiple violations collected
  it('multiple violations → FAIL with all violations reported', () => {
    const m = validManifest({
      resources: [
        { id: 'bad_id', source: 'x.md', default_path: 'x.md', type: 'file', user_modifiable: false },
        { id: 'also_bad', source: 'y.md', default_path: 'y.md', type: 'file', user_modifiable: false },
      ],
    });
    const result = validateKitManifest(m);
    expect(result.status).toBe('FAIL');
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });
});
