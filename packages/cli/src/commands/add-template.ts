// @cpt-flow:cpt-frontx-flow-cli-scaffolding-add-template:p1
import { resolveComposition } from '../composition/resolve';
import { uniformApply } from '../scaffold/assembler';
import { checkAssemblyConflicts } from '../scaffold/conflict';
import { materializeAssembly, occupiedBoundariesFromProvenance } from '../scaffold/materialize';
import type { ReadProvenanceRecordsFn } from '../scaffold/materialize';
import type { InventoryEntry } from '../inventory/types';
import type { ReadContentItemsFn, WriteFileFn } from '../scaffold/types';
import type { BoundaryConflictEntry } from '../scaffold/state';
import type { ProvenanceWriteFn } from '../provenance/types';

export type AddTemplateResult =
  | { ok: true; message: string; appliedTemplates: string[] }
  | { ok: false; reason: 'unresolved' | 'cycle' | 'manifest-unreadable' | 'provenance-failed'; message: string }
  | { ok: false; reason: 'conflict'; conflicts: BoundaryConflictEntry[]; message: string };

/**
 * cpt-frontx-flow-cli-scaffolding-add-template — applies an installed
 * template, plus any templates its preset references, into an EXISTING
 * repository that already holds applied templates: resolves the set through
 * the shared F10 resolver, stages it through the SAME P14 uniform-apply path
 * used to seed a repository, and submits the staged assembly TOGETHER WITH
 * the boundaries already occupied by the repository's applied templates
 * (derived from its existing provenance records) to the P29 pre-flight
 * conflict check. On pass, materializes ONLY the newly applied templates'
 * contribution and adds one provenance record per newly applied template.
 */
export async function addTemplate(
  templateRef: string,
  targetDir: string,
  lookupFn: (name: string) => InventoryEntry | undefined,
  readContentFn: ReadContentItemsFn,
  writeFileFn: WriteFileFn,
  readProvenanceFn: ReadProvenanceRecordsFn,
  provenanceWriteFn: ProvenanceWriteFn,
): Promise<AddTemplateResult> {
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-invoke
  // entry: apply command invoked with a template reference and the path of a
  // repository that already holds applied templates
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-invoke

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-check-resolved
  const rootEntry = lookupFn(templateRef);
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-check-resolved

  if (!rootEntry) {
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-abort-not-found
    return {
      ok: false,
      reason: 'unresolved',
      message: `Apply aborted — template "${templateRef}" not found in local inventory; no files written.`,
    };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-abort-not-found
  }

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-resolve-set
  const compositionResult = await resolveComposition(rootEntry, templateRef, new Set<string>(), 0, lookupFn);
  if (!compositionResult.ok) {
    return {
      ok: false,
      reason: compositionResult.reason === 'cycle' ? 'cycle' : 'unresolved',
      message:
        compositionResult.reason === 'cycle'
          ? `Apply aborted — cycle detected in composition graph: ${compositionResult.path.join(' → ')}; no files written.`
          : `Apply aborted — ${compositionResult.message}; no files written.`,
    };
  }
  const templateRefs = [...compositionResult.templates.keys()];
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-resolve-set

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-stage
  const applyResult = await uniformApply(templateRefs, true, lookupFn, readContentFn);
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-stage

  if (!applyResult.ok) {
    return { ok: false, reason: applyResult.reason, message: `Apply aborted — ${applyResult.message}` };
  }

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-conflict-check
  const existingProvenance = await readProvenanceFn(targetDir);
  const alreadyOccupiedBoundaries = occupiedBoundariesFromProvenance(existingProvenance, lookupFn);
  const verdict = checkAssemblyConflicts(applyResult.assembly, alreadyOccupiedBoundaries);
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-conflict-check

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-conflict
  if (!verdict.ok) {
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-abort-conflict
    return {
      ok: false,
      reason: 'conflict',
      conflicts: verdict.conflicts,
      message:
        'Apply aborted — the staged assembly claims ground already occupied by an applied template; no files written.',
    };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-abort-conflict
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-conflict

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-materialize
  const materializeResult = await materializeAssembly(
    applyResult.assembly,
    targetDir,
    existingProvenance,
    lookupFn,
    writeFileFn,
    provenanceWriteFn,
  );
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-materialize

  if (!materializeResult.ok) {
    return { ok: false, reason: 'provenance-failed', message: materializeResult.message };
  }

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-done
  return {
    ok: true,
    message: `Apply complete — "${targetDir}" extended; one provenance record added per newly applied template.`,
    appliedTemplates: templateRefs,
  };
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-done
}
