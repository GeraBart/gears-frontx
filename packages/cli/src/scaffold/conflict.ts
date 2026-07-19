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

// Two shared-file claims on the SAME path are compatible only when they
// declare the SAME merge strategy for any region they both claim — that is
// the "compatible declared merge" the DoD requires
// (cpt-frontx-adr-template-ownership-boundary-declaration). Disjoint regions
// never clash regardless of merge strategy.
function hasIncompatibleRegionClash(
  a: OwnershipBoundary,
  b: OwnershipBoundary,
): { path: string } | null {
  for (const sharedA of a.sharedFiles) {
    for (const sharedB of b.sharedFiles) {
      if (sharedA.path !== sharedB.path) continue;
      const overlappingRegions = sharedA.ownedRegions.filter((region) => sharedB.ownedRegions.includes(region));
      if (overlappingRegions.length === 0) continue; // disjoint regions of one shared file — never a clash
      if (sharedA.mergeStrategy === sharedB.mergeStrategy) continue; // compatible declared merge — never a clash
      return { path: sharedA.path };
    }
  }
  return null;
}

// @cpt-dod:cpt-frontx-dod-cli-scaffolding-conflict-check:p1
// @cpt-algo:cpt-frontx-algo-cli-scaffolding-conflict-check:p1
/**
 * The F12 pre-flight assembly conflict checker (Option C) realizing
 * `cpt-frontx-algo-cli-scaffolding-conflict-check`. Combines the STAGED
 * assembly's declared ownership boundaries with the boundaries already
 * occupied by the repository's applied templates, compares every pair of
 * boundary claims, and detects two clash kinds: an exclusive-subtree clash
 * (two templates claiming the same exclusive subtree) and a shared-file
 * region clash (two templates claiming the same shared-file region without a
 * compatible declared merge). When any conflict is found the whole assembly
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
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-region-clash
      // Detect the same shared-file region claimed without a compatible
      // declared merge.
      const regionClash = hasIncompatibleRegionClash(claimA.boundary, claimB.boundary);
      if (regionClash) {
        // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-region-clash

        // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-record-region-conflict
        // Record the shared-file-region conflict — the contested ground and
        // the two contesting template identities.
        conflicts.push({ ground: regionClash.path, contestants: [claimA.templateName, claimB.templateName] });
        // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-record-region-conflict
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
