// @cpt-algo:cpt-frontx-algo-upgrade-changeset-rollback:p1
// @cpt-dod:cpt-frontx-dod-upgrade-changeset-rollback:p1
import { ChangeSetLifecycleState } from './state.js';
import type { ProjectSnapshot, WriteProjectFileFn, RemoveProjectFileFn } from './types.js';

export type RollbackResult = { ok: true } | { ok: false; message: string };

// @cpt-begin:cpt-frontx-algo-upgrade-changeset-rollback:p1:inst-rb-if-no-snapshot
export async function rollbackChangeSet(
  snapshot: ProjectSnapshot | null,
  _projectRoot: string,
  deps: {
    writeProjectFile: WriteProjectFileFn;
    removeProjectFile: RemoveProjectFileFn;
  },
): Promise<RollbackResult> {
  if (!snapshot) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-rollback:p1:inst-rb-no-snapshot
    return { ok: false, message: 'Rollback not available — no retained pre-upgrade snapshot.' };
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-rollback:p1:inst-rb-no-snapshot
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-rollback:p1:inst-rb-if-no-snapshot

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-rollback:p1:inst-rb-for-each
  for (const [filePath, originalContent] of snapshot.files) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-rollback:p1:inst-rb-restore-file
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-rollback:p1:inst-rb-restore-provenance
    if (originalContent === null) {
      try {
        await deps.removeProjectFile(filePath);
      } catch {
        // File may not exist if apply added it and a later apply step failed — safe to ignore
      }
    } else {
      await deps.writeProjectFile(filePath, originalContent);
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-rollback:p1:inst-rb-restore-provenance
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-rollback:p1:inst-rb-restore-file
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-rollback:p1:inst-rb-for-each

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-rollback:p1:inst-rb-release-snapshot
  // Snapshot reference is held by the caller; they should clear it after this call returns.
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-rollback:p1:inst-rb-release-snapshot

  // @cpt-begin:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-applied-to-rolledback
  void ChangeSetLifecycleState.ROLLED_BACK; // FROM APPLIED TO ROLLED_BACK — triggered by successful rollback
  // @cpt-end:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-applied-to-rolledback

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-rollback:p1:inst-rb-return-success
  return { ok: true };
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-rollback:p1:inst-rb-return-success
}
