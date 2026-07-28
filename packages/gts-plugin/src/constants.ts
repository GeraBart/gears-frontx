/**
 * GTS Well-Known Lifecycle Action IDs
 *
 * Concrete GTS-notation type IDs for the MFE Runtime's well-known
 * lifecycle actions (load/mount/unmount). Owned exclusively by this
 * plugin — the generic runtime never spells these literals; it asks the
 * injected `TypeSystemPlugin` to resolve them via
 * `resolveLoadExtActionId()` / `resolveMountExtActionId()` /
 * `resolveUnmountExtActionId()`.
 *
 * @packageDocumentation
 */

export const FRONTX_ACTION_LOAD_EXT = 'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.load_ext.v1~';
export const FRONTX_ACTION_MOUNT_EXT = 'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.mount_ext.v1~';
export const FRONTX_ACTION_UNMOUNT_EXT = 'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.unmount_ext.v1~';
