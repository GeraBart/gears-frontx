// @cpt-flow:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1
import { describe, it, expect, vi } from 'vitest';
import { installCommand } from '../../commands/install';
import { TemplateInventory } from '../../inventory/TemplateInventory';
import type { FetchFn } from '../../resolver/types';
import type { DiscoveryHookContext, ExtensionDiscoveryHook } from '../types';

function makeSuccessFetch(content = 'template-content'): FetchFn {
  return vi.fn().mockResolvedValue(content);
}

function makeFailFetch(message = 'Network error'): FetchFn {
  return vi.fn().mockRejectedValue(new Error(message));
}

describe('install-time extension discovery hook (cross-pillar edge F16 <- F10)', () => {
  it('a successful install triggers the discovery hook with the installed name and ref', async () => {
    const inventory = new TemplateInventory();
    const fetch = makeSuccessFetch();
    const hook: ExtensionDiscoveryHook = vi.fn().mockResolvedValue({ triggered: true, errorCount: 0 });

    const result = await installCommand('github:acme/my-template@v1.0.0', inventory, fetch, hook);

    expect(result.ok).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
    const context = (hook as ReturnType<typeof vi.fn>).mock.calls[0][0] as DiscoveryHookContext;
    expect(context.name).toBe('my-template');
    expect(context.ref).toBe('v1.0.0');
    expect(result.discovery).toEqual({ triggered: true, errorCount: 0 });
  });

  it('a failed install does NOT trigger the discovery hook', async () => {
    const inventory = new TemplateInventory();
    const fetch = makeFailFetch();
    const hook: ExtensionDiscoveryHook = vi.fn().mockResolvedValue({ triggered: true });

    const result = await installCommand('github:acme/my-template@v1.0.0', inventory, fetch, hook);

    expect(result.ok).toBe(false);
    expect(hook).not.toHaveBeenCalled();
  });

  it('install without a discovery hook behaves exactly as before (no discovery field)', async () => {
    const inventory = new TemplateInventory();
    const fetch = makeSuccessFetch();

    const result = await installCommand('github:acme/my-template@v1.0.0', inventory, fetch);

    expect(result.ok).toBe(true);
    expect(result.discovery).toBeUndefined();
  });
});
