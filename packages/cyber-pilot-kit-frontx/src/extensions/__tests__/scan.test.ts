// @cpt-algo:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1
import { describe, it, expect } from 'vitest';
import { scanAndComposeExtensions, type BaseCapabilities } from '../scan.js';
import type { AiExtensionEntry } from '../types.js';

function emptyBase(): BaseCapabilities {
  return new Map([
    ['skills', []],
    ['workflows', []],
    ['guidelines', []],
    ['reference_artifacts', []],
  ]);
}

describe('scanAndComposeExtensions', () => {
  it('finds bundle entries and composes them into the discovered set for each slot', () => {
    const bundle = [
      { id: 'skill-1', category: 'skills', path: 'skills/skill-1.md' },
      { id: 'workflow-1', category: 'workflows', path: 'workflows/workflow-1.md' },
    ];
    const result = scanAndComposeExtensions(bundle, emptyBase(), 0);
    expect(result.errors).toHaveLength(0);
    expect(result.composed.get('skills')?.get('skill-1')?.entry.path).toBe('skills/skill-1.md');
    expect(result.composed.get('workflows')?.get('workflow-1')?.entry.path).toBe('workflows/workflow-1.md');
  });

  it('is deterministic: identical inputs produce identical composed order', () => {
    const bundle = [
      { id: 'skill-1', category: 'skills', path: 'skills/skill-1.md' },
      { id: 'skill-2', category: 'skills', path: 'skills/skill-2.md' },
    ];
    const first = scanAndComposeExtensions(bundle, emptyBase(), 0);
    const second = scanAndComposeExtensions(bundle, emptyBase(), 0);
    expect(Array.from(first.composed.get('skills')?.keys() ?? [])).toEqual(
      Array.from(second.composed.get('skills')?.keys() ?? []),
    );
    expect(first.composed.get('skills')?.get('skill-1')).toEqual(second.composed.get('skills')?.get('skill-1'));
  });

  it('template-contributed entries supersede base-kit entries for the same slot+id', () => {
    const baseSkill: AiExtensionEntry = { id: 'shared-skill', category: 'skills', path: 'base/shared-skill.md' };
    const base: BaseCapabilities = new Map([
      ['skills', [baseSkill]],
      ['workflows', []],
      ['guidelines', []],
      ['reference_artifacts', []],
    ]);
    const bundle = [{ id: 'shared-skill', category: 'skills', path: 'template/shared-skill.md' }];
    const result = scanAndComposeExtensions(bundle, base, 0);
    const composedEntry = result.composed.get('skills')?.get('shared-skill');
    expect(composedEntry?.source).toBe('template');
    expect(composedEntry?.entry.path).toBe('template/shared-skill.md');
  });

  it('among multiple templates, installation-order precedence determines the surviving entry', () => {
    const firstInstall = scanAndComposeExtensions(
      [{ id: 'shared-skill', category: 'skills', path: 'first/shared-skill.md' }],
      emptyBase(),
      0,
    );
    const baseAfterFirst: BaseCapabilities = new Map([
      ['skills', Array.from(firstInstall.composed.get('skills')?.values() ?? []).map((c) => c.entry)],
      ['workflows', []],
      ['guidelines', []],
      ['reference_artifacts', []],
    ]);
    const secondInstall = scanAndComposeExtensions(
      [{ id: 'shared-skill', category: 'skills', path: 'second/shared-skill.md' }],
      baseAfterFirst,
      1,
    );
    expect(secondInstall.composed.get('skills')?.get('shared-skill')?.entry.path).toBe('second/shared-skill.md');
  });

  it('a malformed entry produces a structural error and is excluded from the discovered/composed set', () => {
    const bundle = [{ id: 'broken', category: 'skills' }]; // missing path
    const result = scanAndComposeExtensions(bundle, emptyBase(), 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].entryId).toBe('broken');
    expect(result.composed.get('skills')?.has('broken')).toBe(false);
  });

  it('an entry naming a category outside the closed set produces a structural error, not a silent skip', () => {
    const bundle = [{ id: 'oob', category: 'mocks', path: 'mocks/oob.md' }];
    const result = scanAndComposeExtensions(bundle, emptyBase(), 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/outside the closed set/);
  });

  it('a rejection in one entry does not affect conforming entries from the same bundle', () => {
    const bundle = [
      { id: 'broken', category: 'skills' },
      { id: 'ok-skill', category: 'skills', path: 'skills/ok-skill.md' },
    ];
    const result = scanAndComposeExtensions(bundle, emptyBase(), 0);
    expect(result.errors).toHaveLength(1);
    expect(result.composed.get('skills')?.has('ok-skill')).toBe(true);
  });
});
