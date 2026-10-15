import { describe, expect, it } from 'vitest';
import * as routingTanstack from '../index.js';

// This package's entry point carries `ExtensionRouter`, `navigation`, and
// the engine's route-tree builders and scoped route hooks; the exact runtime
// surface is pinned by `./public-entry.test.ts`.
describe('@gears-frontx/routing-tanstack entry point', () => {
  it('loads without throwing', () => {
    expect(routingTanstack).toBeDefined();
  });
});
