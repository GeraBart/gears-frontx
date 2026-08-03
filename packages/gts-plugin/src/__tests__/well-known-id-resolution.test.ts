/**
 * Well-known id resolution.
 *
 * `GtsPlugin` is the sole owner of the GTS-notation literals for the runtime's
 * well-known actions (load_ext/mount_ext/unmount_ext) and lifecycle stages
 * (init/activated/deactivated/destroyed) — @gears-frontx/mfes asks for them
 * through the port and never spells one itself. Nothing downstream can notice
 * a wrong or drifted literal: the runtime forwards whatever it gets, and a
 * consumer whose schemas key off the real id would just go unmatched.
 *
 * The expected ids are therefore spelled out here as golden values rather than
 * imported from `../constants` — comparing a method against the constant it
 * returns proves nothing, while these catch both a cross-wired method (the
 * activated getter answering with the deactivated id) and an edit to the
 * constants themselves.
 */
// @cpt-algo:cpt-frontx-algo-gts-type-provider-typof-resolution:p1
import { describe, it, expect } from 'vitest';
// @internal — colocated test, direct relative import is permitted.
import { GtsPlugin } from '../plugin';

const plugin = new GtsPlugin();

describe('GtsPlugin resolves the framework well-known action ids', () => {
  it('answers the load_ext action with its GTS id, byte for byte', () => {
    // inst-tr-04
    expect(plugin.resolveLoadExtActionId()).toBe(
      'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.load_ext.v1~'
    );
  });

  it('answers the mount_ext action with its GTS id, byte for byte', () => {
    // inst-tr-05
    expect(plugin.resolveMountExtActionId()).toBe(
      'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.mount_ext.v1~'
    );
  });

  it('answers the unmount_ext action with its GTS id, byte for byte', () => {
    // inst-tr-06
    expect(plugin.resolveUnmountExtActionId()).toBe(
      'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.unmount_ext.v1~'
    );
  });
});

describe('GtsPlugin resolves the framework well-known lifecycle stage ids', () => {
  it('answers the init stage with its GTS id, byte for byte', () => {
    // inst-tr-07
    expect(plugin.resolveLifecycleStageInitId()).toBe(
      'gts.frontx.mfes.lifecycle.stage.v1~frontx.mfes.lifecycle.init.v1'
    );
  });

  it('answers the activated stage with its GTS id, byte for byte', () => {
    // inst-tr-08
    expect(plugin.resolveLifecycleStageActivatedId()).toBe(
      'gts.frontx.mfes.lifecycle.stage.v1~frontx.mfes.lifecycle.activated.v1'
    );
  });

  it('answers the deactivated stage with its GTS id, byte for byte', () => {
    // inst-tr-09
    expect(plugin.resolveLifecycleStageDeactivatedId()).toBe(
      'gts.frontx.mfes.lifecycle.stage.v1~frontx.mfes.lifecycle.deactivated.v1'
    );
  });

  it('answers the destroyed stage with its GTS id, byte for byte', () => {
    // inst-tr-10
    expect(plugin.resolveLifecycleStageDestroyedId()).toBe(
      'gts.frontx.mfes.lifecycle.stage.v1~frontx.mfes.lifecycle.destroyed.v1'
    );
  });
});
