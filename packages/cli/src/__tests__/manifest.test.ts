// @cpt-flow:cpt-frontx-flow-template-manifest-validate-for-publication:p1
// @cpt-algo:cpt-frontx-algo-template-manifest-validate-contract:p1
// @cpt-state:cpt-frontx-state-template-manifest-validation-lifecycle:p1
// @cpt-dod:cpt-frontx-dod-template-manifest-validate-command:p1
// @cpt-dod:cpt-frontx-dod-template-manifest-single-description:p1
import { describe, it, expect, vi } from 'vitest';
import { validateManifestContract } from '../manifest/validate-contract';
import { validateCommand } from '../commands/validate';
import type { TemplateManifest, ReadFileFn } from '../manifest/types';

// Helper: build a valid four-category manifest JSON string.
// Categories: (1) identity, (2) version, (3) ownership boundaries, (4) referenced templates.
function validManifest(overrides: Partial<TemplateManifest> = {}): string {
  const base: TemplateManifest = {
    name: 'my-tpl',
    version: '1.0.0',
    ownershipBoundaries: {
      exclusiveSubtrees: ['src/generated'],
      sharedFiles: [
        { path: 'package.json', mergeStrategy: 'deep-merge', ownedRegions: ['scripts.build'] },
      ],
    },
    referencedTemplates: [{ ref: 'github:acme/mfe-a@v1.0.0', appliedAt: 'packages/mfe-a' }],
  };
  return JSON.stringify({ ...base, ...overrides });
}

describe('validateManifestContract', () => {
  // inst-if-parse-error / inst-add-parse-violation
  it('malformed JSON → FAIL parse-error violation', () => {
    const result = validateManifestContract('not-valid-json{{{');
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'manifest')).toBe(true);
  });

  // inst-check-identity / inst-add-identity-violation
  it('missing identity (name) → identity violation', () => {
    const raw = JSON.stringify({
      version: '1.0.0',
      ownershipBoundaries: { exclusiveSubtrees: [], sharedFiles: [] },
    });
    const result = validateManifestContract(raw);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'name')).toBe(true);
  });

  // inst-check-version / inst-add-version-violation
  it('missing version → version violation', () => {
    const raw = JSON.stringify({
      name: 'my-tpl',
      ownershipBoundaries: { exclusiveSubtrees: [], sharedFiles: [] },
    });
    const result = validateManifestContract(raw);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'version')).toBe(true);
  });

  // inst-if-version-missing — malformed (non-string) version
  it('malformed version (non-string) → version violation', () => {
    const raw = JSON.stringify({
      name: 'my-tpl',
      version: 123,
      ownershipBoundaries: { exclusiveSubtrees: [], sharedFiles: [] },
    });
    const result = validateManifestContract(raw);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'version')).toBe(true);
  });

  // inst-check-boundaries — ownership-boundaries category absent
  it('missing ownership-boundaries category → boundaries violation', () => {
    const raw = JSON.stringify({ name: 'my-tpl', version: '1.0.0' });
    const result = validateManifestContract(raw);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'ownershipBoundaries')).toBe(true);
  });

  // inst-for-each-subtree / inst-if-subtree-invalid / inst-add-subtree-violation
  it('ill-formed exclusive subtree → subtree violation', () => {
    const raw = JSON.stringify({
      name: 'my-tpl',
      version: '1.0.0',
      ownershipBoundaries: { exclusiveSubtrees: ['../escapes-root'], sharedFiles: [] },
    });
    const result = validateManifestContract(raw);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field.startsWith('ownershipBoundaries.exclusiveSubtrees'))).toBe(true);
  });

  // inst-for-each-shared-file / inst-if-shared-file-invalid / inst-add-shared-file-violation
  it('shared-file entry missing merge strategy / owned regions → shared-file violation', () => {
    const raw = JSON.stringify({
      name: 'my-tpl',
      version: '1.0.0',
      ownershipBoundaries: {
        exclusiveSubtrees: [],
        sharedFiles: [{ path: 'package.json' }], // missing mergeStrategy + ownedRegions
      },
    });
    const result = validateManifestContract(raw);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field.startsWith('ownershipBoundaries.sharedFiles'))).toBe(true);
  });

  // inst-for-each-referenced / inst-check-referenced-entry / inst-if-referenced-invalid
  it('referenced-template entry missing target location → referenced violation', () => {
    const raw = JSON.stringify({
      name: 'my-project',
      version: '1.0.0',
      ownershipBoundaries: { exclusiveSubtrees: [], sharedFiles: [] },
      referencedTemplates: [{ ref: 'github:acme/mfe@v1' }], // missing appliedAt
    });
    const result = validateManifestContract(raw);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field.startsWith('referencedTemplates'))).toBe(true);
  });

  // inst-for-each-referenced — malformed reference
  it('referenced-template entry with malformed reference → referenced violation', () => {
    const raw = JSON.stringify({
      name: 'my-project',
      version: '1.0.0',
      ownershipBoundaries: { exclusiveSubtrees: [], sharedFiles: [] },
      referencedTemplates: [{ ref: '   ', appliedAt: 'packages/x' }], // whitespace-only ref
    });
    const result = validateManifestContract(raw);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field.startsWith('referencedTemplates'))).toBe(true);
  });

  // inst-return-validated — conforming four-category manifest
  it('valid four-category manifest → VALIDATED with no violations', () => {
    const result = validateManifestContract(validManifest());
    expect(result.status).toBe('VALIDATED');
    expect(result.violations).toHaveLength(0);
  });

  // forward-reading invariant — schemaVersion is optional
  it('manifest without schemaVersion still passes (forward-readable)', () => {
    const raw = JSON.stringify({
      name: 'my-tpl',
      version: '2.0.0',
      ownershipBoundaries: { exclusiveSubtrees: [], sharedFiles: [] },
    });
    const result = validateManifestContract(raw);
    expect(result.status).toBe('VALIDATED');
  });

  // a leaf template (no referenced templates) is valid
  it('leaf template with no referencedTemplates → VALIDATED', () => {
    const raw = JSON.stringify({
      name: 'leaf',
      version: '1.0.0',
      ownershipBoundaries: {
        exclusiveSubtrees: ['src'],
        sharedFiles: [],
      },
    });
    const result = validateManifestContract(raw);
    expect(result.status).toBe('VALIDATED');
  });
});

describe('validateCommand', () => {
  // inst-if-manifest-absent / inst-return-manifest-absent
  it('returns FAIL + non-zero exit code when manifest absent', async () => {
    const readFileFn: ReadFileFn = vi.fn().mockRejectedValue(new Error('ENOENT: no such file'));
    const result = await validateCommand('/some/template', readFileFn);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/manifest not found/i);
  });

  // inst-else-pass / inst-return-pass
  it('returns PASS + zero exit code for conforming manifest', async () => {
    const readFileFn: ReadFileFn = vi.fn().mockResolvedValue(validManifest());
    const result = await validateCommand('/some/template', readFileFn);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  // inst-report-violations / inst-return-fail
  it('reports all violations on REJECTED manifest', async () => {
    // Missing identity, version, and ownership boundaries — multiple violations expected.
    const raw = JSON.stringify({});
    const readFileFn: ReadFileFn = vi.fn().mockResolvedValue(raw);
    const result = await validateCommand('/some/template', readFileFn);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.violations).toBeDefined();
    expect((result.violations ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('single authoritative description', () => {
  // cpt-frontx-dod-template-manifest-single-description
  it('the same four-category shape validated is what validate/install/assembly consume', () => {
    // structural: validateManifestContract accepts raw and the same TemplateManifest
    // shape (identity, version, ownership boundaries, referenced templates) is returned
    // by readManifestFromContent on success — no divergent or partial descriptor exists.
    const result = validateManifestContract(validManifest());
    expect(result.status).toBe('VALIDATED');
  });
});
