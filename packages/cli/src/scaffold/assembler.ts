import type { InventoryEntry } from '../inventory/types.js';
import { readManifestFromContent } from '../manifest/validate-contract.js';
import type { TemplateManifest } from '../manifest/types.js';
import type { ContributionEntry, StagedAssembly } from './types.js';

export type UniformApplyResult =
  | { ok: true; assembly: StagedAssembly }
  | { ok: false; reason: 'unresolved'; templateRef: string; message: string }
  | { ok: false; reason: 'manifest-unreadable'; templateRef: string; message: string };

// @cpt-dod:cpt-frontx-dod-cli-scaffolding-uniform-apply:p1
// The system MUST apply any installed template through this one uniform path.
// Seeding a new repository and adding a template into a repository that
// already holds applied templates both call `uniformApply` — they differ
// ONLY in `targetHoldsAppliedTemplates`. There is no per-template-category
// dispatch (no `scaffoldProject` / `scaffoldMfe` split — that old-model
// surface was swept in this same phase) and no second apply path: template
// resolution routes exclusively through the injected `lookupFn`, the single
// shared resolver produced by P12 (`TemplateInventory.lookup`).
// @cpt-algo:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1
/**
 * The ONE apply path both `seed a repository` and `add a template into an
 * existing repository` invoke (cpt-frontx-flow-cli-scaffolding-seed-repository,
 * cpt-frontx-flow-cli-scaffolding-add-template — implemented in P30). Resolves
 * every reference through the shared resolver, reads each resolved template's
 * manifest, and stages every template's contribution + declared ownership
 * boundaries into one assembly for the pre-flight conflict check (P29) to
 * evaluate before any file is written.
 */
export async function uniformApply(
  templateRefs: string[],
  targetHoldsAppliedTemplates: boolean,
  lookupFn: (name: string) => InventoryEntry | undefined,
): Promise<UniformApplyResult> {
  // Seed vs add differ ONLY in this flag — it plays no role in staging the
  // assembly itself; the pre-flight conflict check (P29) uses it to decide
  // which already-occupied boundaries to compare against.
  void targetHoldsAppliedTemplates;

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-receive
  const resolvedEntries: InventoryEntry[] = [];
  for (const templateRef of templateRefs) {
    const entry = lookupFn(templateRef);
    if (!entry) {
      return {
        ok: false,
        reason: 'unresolved',
        templateRef,
        message: `Apply aborted — template "${templateRef}" not found in local inventory.`,
      };
    }
    resolvedEntries.push(entry);
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-receive

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-read-manifests
  const resolvedManifests: Array<{ entry: InventoryEntry; manifest: TemplateManifest }> = [];
  for (const entry of resolvedEntries) {
    const manifestResult = readManifestFromContent(entry.content);
    if (!manifestResult.ok) {
      return {
        ok: false,
        reason: 'manifest-unreadable',
        templateRef: entry.name,
        message: `Cannot read manifest for "${entry.name}": ${manifestResult.message}`,
      };
    }
    resolvedManifests.push({ entry, manifest: manifestResult.manifest });
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-read-manifests

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-foreach-template
  const contributions: ContributionEntry[] = [];
  for (const { entry, manifest } of resolvedManifests) {
    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-compute-contribution
    const contribution: ContributionEntry = {
      templateName: entry.name,
      files: manifest.files ?? [],
      ownershipBoundaries: manifest.ownershipBoundaries,
    };
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-compute-contribution

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-stage-contribution
    contributions.push(contribution);
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-stage-contribution
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-foreach-template

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-return-staged
  return { ok: true, assembly: { contributions } };
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-return-staged
}
