import type { OwnershipBoundary } from '../manifest/types';
import type { StagedAssembly } from './types';
import type { BoundaryConflictEntry, ConflictVerdict, OccupiedBoundaryEntry } from './state';

// A single boundary claim tagged with its owning template identity — the
// comparison unit inst-cc-combine builds by combining the staged assembly's
// declared boundaries with the boundaries already occupied in the target
// repository.
interface BoundaryClaim {
  templateName: string;
  boundary: OwnershipBoundary;
}

// @cpt-dod:cpt-frontx-dod-cli-scaffolding-conflict-check:p1
// @cpt-algo:cpt-frontx-algo-cli-scaffolding-conflict-check:p1
/**
 * The F12 pre-flight assembly conflict checker (Option C) realizing
 * `cpt-frontx-algo-cli-scaffolding-conflict-check`. Combines the STAGED
 * assembly's declared ownership boundaries with the boundaries already
 * occupied by the repository's applied templates, compares every pair of
 * boundary claims, and detects three clash kinds: an exclusive-subtree clash
 * (two templates claiming the same exclusive subtree), an exclusive
 * shared-file clash (two templates claiming the same shared-file path where
 * either both declare merge strategy `exclusive`, or one declares
 * `exclusive` while the other declares `region-union` — whole-file ownership
 * of a shared file cannot be shared), and a region-key clash (two templates
 * declaring merge strategy `region-union` on the same shared-file path and
 * claiming the same declared region key). When any conflict is found the whole assembly
 * is REFUSED — the report names each contested ground and its contesting
 * templates, before any file is written; conflicting claims are never
 * silently merged. On no conflict, returns a pass so the P14 uniform-apply
 * core can proceed.
 *
 * This is the SOLE authority for boundary-collision arbitration — the A2
 * reframe relocated arbitration OUT of composed-provenance recursive
 * resolution (`cpt-frontx-algo-composed-provenance-recursive-resolution`)
 * INTO this check.
 */
export function checkAssemblyConflicts(
  assembly: StagedAssembly,
  alreadyOccupiedBoundaries: OccupiedBoundaryEntry[],
): ConflictVerdict {
  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-combine
  // Combine the staged assembly's declared boundaries with the boundaries
  // already occupied in the target repository into one comparison set, each
  // entry tagged with its owning template identity.
  const claims: BoundaryClaim[] = [
    ...assembly.contributions.map((contribution) => ({
      templateName: contribution.templateName,
      boundary: contribution.ownershipBoundaries,
    })),
    ...alreadyOccupiedBoundaries.map((occupied) => ({
      templateName: occupied.templateName,
      boundary: occupied.boundary,
    })),
  ];
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-combine

  const conflicts: BoundaryConflictEntry[] = [];

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-foreach-pair
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const claimA = claims[i];
      const claimB = claims[j];

      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-subtree-clash
      // Detect two templates claiming the same exclusive subtree.
      for (const subtreeA of claimA.boundary.exclusiveSubtrees) {
        for (const subtreeB of claimB.boundary.exclusiveSubtrees) {
          if (subtreeA !== subtreeB) continue;
          // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-subtree-clash

          // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-record-subtree-conflict
          // Record the exclusive-subtree conflict — the contested ground and
          // the two contesting template identities.
          conflicts.push({ ground: subtreeA, contestants: [claimA.templateName, claimB.templateName] });
          // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-record-subtree-conflict
        }
      }
      for (const sharedA of claimA.boundary.sharedFiles) {
        for (const sharedB of claimB.boundary.sharedFiles) {
          if (sharedA.path !== sharedB.path) continue;

          // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-exclusive-clash
          // Both templates claim the same shared-file path AND either both
          // declare merge strategy `exclusive` for it, or one declares
          // `exclusive` while the other declares `region-union` — whole-file
          // ownership of a shared file cannot be shared.
          const eitherExclusive = sharedA.mergeStrategy === 'exclusive' || sharedB.mergeStrategy === 'exclusive';
          if (eitherExclusive) {
            // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-exclusive-clash

            // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-record-exclusive-conflict
            // Record a conflict entry naming the contested file path and the
            // two contesting template identities.
            conflicts.push({ ground: sharedA.path, contestants: [claimA.templateName, claimB.templateName] });
            // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-record-exclusive-conflict
            continue;
          }

          // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-region-key-clash
          // Both templates declare merge strategy `region-union` on the same
          // shared-file path AND claim the same declared region key.
          const sharedRegionKeys = sharedA.ownedRegions.filter((region) => sharedB.ownedRegions.includes(region));
          for (const regionKey of sharedRegionKeys) {
            // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-region-key-clash

            // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-record-region-conflict
            // Record a conflict entry naming the contested file path, the
            // contested region key (folded into the ground as
            // `${path}#${regionKey}`), and the two contesting template
            // identities.
            conflicts.push({
              ground: `${sharedA.path}#${regionKey}`,
              contestants: [claimA.templateName, claimB.templateName],
            });
            // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-record-region-conflict
          }
        }
      }
    }
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-foreach-pair

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-any-conflict
  if (conflicts.length > 0) {
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-any-conflict

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-return-conflict
    // Refuse the whole assembly and return the conflict report — naming every
    // contested ground and its contesting templates — BEFORE any file is
    // written. Never silently merged.
    return { ok: false, conflicts };
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-return-conflict
  }

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-return-pass
  // No intersecting boundary claim — pass, so the P14 uniform-apply core can
  // proceed to materialize the assembly.
  return { ok: true };
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-return-pass
}
