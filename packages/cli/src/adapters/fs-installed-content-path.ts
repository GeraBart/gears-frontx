// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
import path from 'node:path';

// Computes the addressable path at which a named template's ACTUAL on-disk
// files live in the local inventory store — the "installed content path"
// the FEATURE specifies (`cpt-frontx-algo-template-resolution-resolve-to-inventory`
// inst-resolve-write, inst-resolve-return). Downstream apply/assembly
// (`cpt-frontx-algo-cli-scaffolding-uniform-apply` inst-ua-read-content) reads
// a template's content items directly from this path, never from the
// manifest. Pure path arithmetic — no filesystem access here.
export function resolveInstalledContentPath(root: string, name: string): string {
  return path.join(root, name);
}

// @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-boundary-confirm
// Confirms that a candidate path resolves to somewhere WITHIN the inventory
// store root — the boundary invariant a bounded local update must uphold
// against a real filesystem path (never outside the local inventory store).
// Throws explicitly rather than silently truncating/ignoring an escape.
export function assertWithinRoot(root: string, candidatePath: string): void {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidatePath);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  const escapesRoot = relative.startsWith('..') || path.isAbsolute(relative);
  if (escapesRoot) {
    throw new Error(
      `Refusing write outside inventory store root: "${candidatePath}" is not within "${root}".`,
    );
  }
}
// @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-boundary-confirm
