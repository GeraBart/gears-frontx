// @cpt-algo:cpt-frontx-algo-upgrade-changeset-apply:p1
// @cpt-dod:cpt-frontx-dod-upgrade-changeset-apply:p1
import { provenancePath } from '../provenance/contract';
import type {
  ChangeSet,
  ProjectSnapshot,
  ProvenanceRecord,
  ReadProjectFileFn,
  WriteProjectFileFn,
  RemoveProjectFileFn,
  WriteProvenanceFn,
} from './types';

export type ApplyResult =
  | { ok: true; snapshot: ProjectSnapshot }
  | { ok: false; message: string };

// @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-snapshot
export async function applyChangeSet(
  changeSet: ChangeSet,
  projectRoot: string,
  currentProvenance: ProvenanceRecord,
  deps: {
    readProjectFile: ReadProjectFileFn;
    writeProjectFile: WriteProjectFileFn;
    removeProjectFile: RemoveProjectFileFn;
    writeProvenance: WriteProvenanceFn;
  },
): Promise<ApplyResult> {
  // Capture pre-upgrade snapshot of all affected files so rollback can restore exact state
  const snapshot: ProjectSnapshot = { files: new Map() };
  const provPath = provenancePath(projectRoot);

  // Snapshot the provenance file
  const provContent = await deps.readProjectFile(provPath);
  snapshot.files.set(provPath, provContent);

  // Snapshot all files affected by clean entries
  for (const entry of changeSet.clean) {
    const absolutePath = `${projectRoot}/${entry.path}`;
    const existingContent = await deps.readProjectFile(absolutePath);
    snapshot.files.set(absolutePath, existingContent);
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-snapshot

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-try
  try {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-for-each-entry
    for (const entry of changeSet.clean) {
      const absolutePath = `${projectRoot}/${entry.path}`;
      // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-apply-entry
      if (entry.kind === 'remove') {
        await deps.removeProjectFile(absolutePath);
      } else {
        await deps.writeProjectFile(absolutePath, entry.content!);
      }
      // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-apply-entry
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-for-each-entry
  } catch (err) {
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-try
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-catch
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-restore-on-error
    for (const [filePath, originalContent] of snapshot.files) {
      try {
        if (originalContent === null) {
          await deps.removeProjectFile(filePath);
        } else {
          await deps.writeProjectFile(filePath, originalContent);
        }
      } catch {
        // Best-effort restore — do not mask the original error
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-restore-on-error
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-return-failure
    return { ok: false, message: `Apply failed and was restored: ${message}` };
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-return-failure
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-catch
  }

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-update-prov
  const updatedProvenance: ProvenanceRecord = {
    ...currentProvenance,
    scaffoldedFromVersion: changeSet.targetVersion,
  };
  await deps.writeProvenance(provPath, JSON.stringify(updatedProvenance, null, 2));
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-update-prov

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-retain-snapshot
  // Snapshot is returned to the caller for rollback — retained until a new upgrade cycle
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-retain-snapshot

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-return-success
  return { ok: true, snapshot };
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-return-success
}
