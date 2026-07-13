// @cpt-dod:cpt-frontx-dod-template-ai-extensions-contract-conformance:p1
import { describe, it, expect } from 'vitest';
import { isExtensionCategory, validateExtensionEntry } from '../contract.js';
import { EXTENSION_CATEGORIES } from '../types.js';

describe('closed-set extension contract', () => {
  it('exposes exactly four named typed slots: skills, workflows, guidelines, reference_artifacts', () => {
    expect(EXTENSION_CATEGORIES).toEqual(['skills', 'workflows', 'guidelines', 'reference_artifacts']);
  });

  it('recognizes each closed-set category', () => {
    for (const category of EXTENSION_CATEGORIES) {
      expect(isExtensionCategory(category)).toBe(true);
    }
  });

  it('rejects an out-of-set category', () => {
    expect(isExtensionCategory('mocks')).toBe(false);
    expect(isExtensionCategory('random-category')).toBe(false);
  });

  it('a conforming entry validates and is returned as an AiExtensionEntry', () => {
    const result = validateExtensionEntry({ id: 'ext-1', category: 'skills', path: 'skills/ext-1.md' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry).toEqual({ id: 'ext-1', category: 'skills', path: 'skills/ext-1.md' });
  });

  it('rejects an entry naming a category outside the closed set', () => {
    const result = validateExtensionEntry({ id: 'ext-1', category: 'mocks', path: 'mocks/ext-1.md' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/outside the closed set/);
  });

  it('rejects an entry missing a required structural element (path)', () => {
    const result = validateExtensionEntry({ id: 'ext-1', category: 'skills' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.slot).toBe('skills');
    expect(result.error.entryId).toBe('ext-1');
  });

  it('rejects an entry missing a required structural element (id)', () => {
    const result = validateExtensionEntry({ category: 'workflows', path: 'workflows/x.md' });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-object entry', () => {
    const result = validateExtensionEntry('not-an-object');
    expect(result.ok).toBe(false);
  });
});
