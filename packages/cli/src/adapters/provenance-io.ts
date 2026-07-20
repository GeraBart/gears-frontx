// @cpt-algo:cpt-frontx-algo-composed-provenance-provenance-write:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-provenance-at-scaffold:p1
import fs from 'node:fs';
import path from 'node:path';
import { provenancePath } from '../provenance/contract';
import type { ProvenanceRecord, ProvenanceWriteFn } from '../provenance/types';

// Real filesystem read+write for the provenance store
// (`cpt-frontx-contract-project-provenance`) — the single file
// `.frontx/provenance.json` at the repository root holding the SET of
// records, one per applied template, with no single whole-repository origin
// record, per the composed-provenance FEATURE's exact schema. Pure-logic core
// (`provenance/write.ts`) already defines `writeProvenance`'s iteration and
// the `ProvenanceWriteFn`/`ProvenanceRecord` seam shapes
// (`packages/cli/src/provenance/types.ts`); this file is the IO-only
// realization plugged in behind those seams — it invents no new shape or
// filename beyond `PROVENANCE_RELATIVE_PATH` (`provenance/contract.ts`).

// @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-write-record
/**
 * Real fs-backed `ProvenanceWriteFn` — the durable, human-readable write
 * target `writeProvenance` (`cpt-frontx-algo-composed-provenance-provenance-write`
 * inst-write-record) invokes for every re-written provenance set. Creates the
 * `.frontx/` directory on first write.
 */
export function createFsProvenanceWriteFn(): ProvenanceWriteFn {
  return async function writeProvenanceFile(filePath: string, content: string): Promise<void> {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  };
}
// @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-write-record

// @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-determine-storage-location
/**
 * Reads the full provenance SET back from the single file
 * `.frontx/provenance.json` at the repository root — the read-side
 * counterpart to `createFsProvenanceWriteFn`, at the same storage location
 * `provenancePath` (`provenance/contract.ts`) determines. Returns an empty
 * set (never throws) when no provenance file exists yet — e.g. before the
 * first scaffold — since an absent file is not itself a provenance-write
 * error.
 */
export async function readProvenanceRecords(repoRoot: string): Promise<ProvenanceRecord[]> {
  const location = provenancePath(repoRoot);
  if (!fs.existsSync(location)) return [];
  const raw = fs.readFileSync(location, 'utf-8');
  if (raw.trim() === '') return [];
  return JSON.parse(raw) as ProvenanceRecord[];
}
// @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-determine-storage-location

/**
 * Bridges the SET-shaped read above onto the single-record `ReadProvenanceFn`
 * seam the upgrade change-set engine depends on
 * (`packages/cli/src/upgrade/types.ts`) — the upgrade engine currently
 * resolves a baseline from exactly one provenance record per project.
 * Returns the first record in the set, or `null` when the set is empty.
 */
export function createFsReadSingleProvenanceFn(): (repoRoot: string) => Promise<ProvenanceRecord | null> {
  return async function readSingleProvenance(repoRoot: string): Promise<ProvenanceRecord | null> {
    const records = await readProvenanceRecords(repoRoot);
    return records[0] ?? null;
  };
}
