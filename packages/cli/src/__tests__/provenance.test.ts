import { describe, it, expect, vi } from 'vitest';
import { writeProvenance } from '../provenance/write';
import type { ProvenanceRecord } from '../provenance/types';

// Unit coverage for cpt-frontx-algo-composed-provenance-provenance-write:
// ONE in-repository provenance record per applied template, written via a
// real inst-foreach-applied iteration — a SET of records, never a single
// whole-repository origin record (cpt-frontx-contract-project-provenance).
describe('writeProvenance', () => {
  it('(a) writes one record per applied template as a SET — no single whole-repository origin record', async () => {
    const written = new Map<string, string>();
    const writeFn = vi.fn(async (path: string, content: string) => {
      written.set(path, content);
    });

    const applied: ProvenanceRecord[] = [
      {
        templateIdentity: 'root-project',
        scaffoldedFromVersion: '1.0.0',
        sourceSpec: 'local:root-project',
        occupiedOwnershipBoundary: '.',
      },
      {
        templateIdentity: 'mfe-a',
        scaffoldedFromVersion: '2.0.0',
        sourceSpec: 'local:mfe-a',
        occupiedOwnershipBoundary: 'src/mfe-a',
      },
    ];

    const result = await writeProvenance(applied, '/proj', writeFn);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.location).toBe('/proj/.frontx/provenance.json');
    }

    const content = written.get('/proj/.frontx/provenance.json');
    expect(content).toBeDefined();
    const parsed = JSON.parse(content!) as Record<string, unknown>[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      templateIdentity: 'root-project',
      scaffoldedFromVersion: '1.0.0',
      sourceSpec: 'local:root-project',
      occupiedOwnershipBoundary: '.',
    });
    expect(parsed[1]).toEqual({
      templateIdentity: 'mfe-a',
      scaffoldedFromVersion: '2.0.0',
      sourceSpec: 'local:mfe-a',
      occupiedOwnershipBoundary: 'src/mfe-a',
    });
  });

  it('(b) normalizes a single applied template into a one-record set, defaulting the ownership boundary', async () => {
    const written = new Map<string, string>();
    const writeFn = vi.fn(async (path: string, content: string) => {
      written.set(path, content);
    });

    const result = await writeProvenance(
      {
        templateIdentity: 'simple-project',
        scaffoldedFromVersion: '2.1.0',
        sourceSpec: 'local:simple-project',
      },
      '/my-project',
      writeFn,
    );

    expect(result.ok).toBe(true);
    const parsed = JSON.parse(written.get('/my-project/.frontx/provenance.json')!) as Record<string, unknown>[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]['occupiedOwnershipBoundary']).toBe('.');
  });

  it('(c) returns a provenance-write error when a write fails, leaving the assembly incomplete', async () => {
    const writeFn = vi.fn().mockRejectedValue(new Error('disk full'));

    const applied: ProvenanceRecord[] = [
      { templateIdentity: 'root-project', scaffoldedFromVersion: '1.0.0', sourceSpec: 'local:root-project' },
    ];

    const result = await writeProvenance(applied, '/proj', writeFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('root-project');
      expect(result.message).toContain('disk full');
    }
  });
});
