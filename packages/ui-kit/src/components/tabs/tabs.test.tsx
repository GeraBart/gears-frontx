import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import styles from './tabs.module.css';

afterEach(cleanup);

function renderTabs(rootProps: Parameters<typeof Tabs>[0] = {}) {
  return render(
    <Tabs defaultValue="account" {...rootProps}>
      <TabsList>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="password">Password</TabsTrigger>
        <TabsTrigger value="billing" disabled>
          Billing
        </TabsTrigger>
      </TabsList>
      <TabsContent value="account">Account settings</TabsContent>
      <TabsContent value="password">Password settings</TabsContent>
      <TabsContent value="billing">Billing settings</TabsContent>
    </Tabs>,
  );
}

describe('Tabs', () => {
  it('renders every part with its kit class', () => {
    renderTabs();
    expect(screen.getByRole('tablist').className).toContain(styles.list);
    expect(screen.getByRole('tab', { name: 'Account' }).className).toContain(styles.trigger);
    expect(screen.getByText('Account settings').className).toContain(styles.content);
  });

  it('shows only the active panel and marks its tab active', () => {
    renderTabs();
    expect(screen.getByRole('tab', { name: 'Account' }).hasAttribute('data-active')).toBe(true);
    expect((screen.getByText('Account settings') as HTMLElement).hidden).toBe(false);
    expect(screen.queryByText('Password settings')).toBeNull();
  });

  it('switches panels on tab click and reports through onValueChange', async () => {
    const onValueChange = vi.fn();
    renderTabs({ onValueChange });
    fireEvent.click(screen.getByRole('tab', { name: 'Password' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0]?.[0]).toBe('password');
    expect((screen.getByText('Password settings') as HTMLElement).hidden).toBe(false);
    // The outgoing panel unmounts once Base UI's close transition completes
    // (a microtask/animation-frame away, not synchronous with the click).
    await waitFor(() => expect(screen.queryByText('Account settings')).toBeNull());
  });

  it('does not activate a disabled tab', () => {
    const onValueChange = vi.fn();
    renderTabs({ onValueChange });
    const billing = screen.getByRole('tab', { name: 'Billing' });
    // Base UI keeps a disabled Tab focusable (arrow-key navigation must be
    // able to reach and skip it) rather than setting the native `disabled`
    // attribute, so it's `aria-disabled`, not `.disabled`, that reflects it.
    expect(billing.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(billing);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('keeps a disabled tab reachable by arrow-key navigation without activating it', async () => {
    const onValueChange = vi.fn();
    renderTabs({ onValueChange });
    const account = screen.getByRole('tab', { name: 'Account' });
    const password = screen.getByRole('tab', { name: 'Password' });
    const billing = screen.getByRole('tab', { name: 'Billing' });
    account.focus();
    // Base UI moves the roving-tabindex focus itself in an effect that
    // commits after the keydown handler returns, not synchronously within
    // it — hence `waitFor` rather than a bare assertion right after
    // `fireEvent`.
    fireEvent.keyDown(account, { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toBe(password));
    // Arrow focus must still be able to land on the disabled tab — this is
    // exactly what the `[data-disabled]`-only CSS decision (no `:disabled`
    // fallback, see tabs.module.css) depends on staying true.
    fireEvent.keyDown(password, { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toBe(billing));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('defaults TabsList to the default variant and switches to line', () => {
    const { rerender } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">A content</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tablist').className).toContain(styles.variantDefault);
    rerender(
      <Tabs defaultValue="a">
        <TabsList variant="line">
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">A content</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tablist').className).toContain(styles.variantLine);
  });

  it('merges a consumer className on every part without dropping the kit class', () => {
    render(
      <Tabs defaultValue="a" className="consumer" data-testid="root">
        <TabsList className="consumer">
          <TabsTrigger value="a" className="consumer">
            A
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a" className="consumer">
          A content
        </TabsContent>
      </Tabs>,
    );
    const root = screen.getByTestId('root');
    expect(root.className).toContain(styles.tabs);
    expect(root.className).toContain('consumer');
    const list = screen.getByRole('tablist');
    expect(list.className).toContain(styles.list);
    expect(list.className).toContain('consumer');
    const tab = screen.getByRole('tab', { name: 'A' });
    expect(tab.className).toContain(styles.trigger);
    expect(tab.className).toContain('consumer');
    const panel = screen.getByText('A content');
    expect(panel.className).toContain(styles.content);
    expect(panel.className).toContain('consumer');
  });

  it('does not leak the variant prop to the DOM as an attribute', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList variant="line">
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">A content</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tablist').hasAttribute('variant')).toBe(false);
  });

  it('stamps data-orientation on every part, defaulting to horizontal', () => {
    render(
      <Tabs defaultValue="account" data-testid="root">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>
        <TabsContent value="account">Account settings</TabsContent>
      </Tabs>,
    );
    // Root's is the load-bearing one — it's what flips .tabs between a
    // column (list above panel) and a row (list beside panel) in
    // tabs.module.css — so assert it alongside every other part, not just
    // the list and tab.
    expect(screen.getByTestId('root').getAttribute('data-orientation')).toBe('horizontal');
    expect(screen.getByRole('tablist').getAttribute('data-orientation')).toBe('horizontal');
    expect(screen.getByRole('tab', { name: 'Account' }).getAttribute('data-orientation')).toBe(
      'horizontal',
    );
    expect(screen.getByRole('tabpanel').getAttribute('data-orientation')).toBe('horizontal');
  });

  // Base UI puts the open panel in the tab order itself (`tabIndex: open ?
  // 0 : -1`, TabsPanel.js:83) — the panel is keyboard-reachable out of the
  // box, which is why tabs.module.css must pair its `outline: none` with a
  // `.content:focus-visible` ring. The ring itself is CSS and jsdom applies
  // no stylesheets; what this guards is the premise the rule rests on: the
  // open panel stays focusable (and would silently stop needing — or
  // getting — a focus style if that default ever changed or was overridden
  // away).
  it('keeps the open panel keyboard-focusable', () => {
    renderTabs();
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('tabindex')).toBe('0');
    panel.focus();
    expect(document.activeElement).toBe(panel);
  });

  it('switches every part to vertical orientation and keeps arrow-key navigation on its own axis', async () => {
    render(
      <Tabs defaultValue="account" orientation="vertical" data-testid="root">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
        </TabsList>
        <TabsContent value="account">Account settings</TabsContent>
        <TabsContent value="password">Password settings</TabsContent>
      </Tabs>,
    );
    expect(screen.getByTestId('root').getAttribute('data-orientation')).toBe('vertical');
    expect(screen.getByRole('tablist').getAttribute('data-orientation')).toBe('vertical');
    const account = screen.getByRole('tab', { name: 'Account' });
    const password = screen.getByRole('tab', { name: 'Password' });
    expect(account.getAttribute('data-orientation')).toBe('vertical');
    expect(screen.getByRole('tabpanel').getAttribute('data-orientation')).toBe('vertical');
    // Vertical tabs navigate on the block axis (Up/Down); the source's own
    // registry drops `orientation` on the floor before it reaches
    // Tabs.Root (see base-vega's tabs.tsx), which would leave this
    // ArrowDown a no-op and ArrowRight the working key instead — this kit
    // forwards every prop through `...props`, so ArrowDown is the one that
    // must move focus here.
    account.focus();
    fireEvent.keyDown(account, { key: 'ArrowRight' });
    // A wrongly-accepted ArrowRight would move focus via the same queued
    // microtask ArrowDown uses below (`queueMicrotask` in Base UI's
    // useCompositeRoot — not a layout effect, so it survives past this
    // handler's synchronous return). Flush that same window before
    // asserting the no-op, or a real regression here would still read as
    // passing: the assertion below would just be checking `account` before
    // the (incorrect) focus move had a chance to land.
    await act(async () => {});
    expect(document.activeElement).toBe(account);
    fireEvent.keyDown(account, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(password));
  });
});
