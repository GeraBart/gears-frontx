import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createToastManager, Toaster, toast } from './toast';
import styles from './toast.module.css';

// `toast` is a module-scope singleton (see toast.tsx) shared across every
// test in this file — close it out after each test so one test's toast
// can't leak into the next. Tests that don't specifically exercise the
// shared singleton use their own isolated `createToastManager()` instead.
afterEach(() => {
  toast.close();
  cleanup();
});

describe('Toast', () => {
  it('renders the viewport region with no cards when there are no toasts', () => {
    const manager = createToastManager();
    render(<Toaster toastManager={manager} />);
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders an added toast with title, description, and kit classes', async () => {
    const manager = createToastManager();
    render(<Toaster toastManager={manager} />);
    act(() => {
      manager.add({ title: 'Saved', description: 'Your changes have been saved.' });
    });
    const toastEl = await waitFor(() => screen.getByRole('dialog'));
    expect(toastEl.className).toContain(styles.toast);
    expect(screen.getByText('Saved').className).toContain(styles.title);
    expect(screen.getByText('Your changes have been saved.').className).toContain(
      styles.description,
    );
  });

  it('renders a type-driven icon and marks it destructive for the error type', async () => {
    const manager = createToastManager();
    render(<Toaster toastManager={manager} />);
    act(() => {
      manager.add({ type: 'error', title: 'Failed to save' });
    });
    const toastEl = await waitFor(() => screen.getByRole('dialog'));
    const icon = toastEl.querySelector(`.${styles.icon}`);
    expect(icon).toBeTruthy();
    // SVGElement.className is an SVGAnimatedString in jsdom, not a plain
    // string like HTMLElement.className — read the attribute directly.
    expect(icon?.getAttribute('class')).toContain(styles.iconDestructive);
  });

  it('renders no icon when the toast has no type', async () => {
    const manager = createToastManager();
    render(<Toaster toastManager={manager} />);
    act(() => {
      manager.add({ title: 'Untyped' });
    });
    const toastEl = await waitFor(() => screen.getByRole('dialog'));
    expect(toastEl.querySelector(`.${styles.icon}`)).toBeNull();
  });

  it('closes via the built-in close button', async () => {
    const manager = createToastManager();
    render(<Toaster toastManager={manager} />);
    act(() => {
      manager.add({ title: 'Saved' });
    });
    await waitFor(() => screen.getByRole('dialog'));
    // Base UI hides a toast's close button from the accessibility tree
    // (aria-hidden) until the stack is expanded (hovered/focused) — mirrors
    // how a sighted user would engage the stack before it's reachable.
    fireEvent.mouseEnter(screen.getByRole('region', { name: 'Notifications' }));
    const closeButton = await waitFor(() => screen.getByRole('button', { name: 'Close toast' }));
    fireEvent.click(closeButton);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renames the close button via closeLabel for non-English apps', async () => {
    const manager = createToastManager();
    render(<Toaster toastManager={manager} closeLabel="Закрыть уведомление" />);
    act(() => {
      manager.add({ title: 'Сохранено' });
    });
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.mouseEnter(screen.getByRole('region', { name: 'Notifications' }));
    await waitFor(() => screen.getByRole('button', { name: 'Закрыть уведомление' }));
    expect(screen.queryByRole('button', { name: 'Close toast' })).toBeNull();
  });

  it('renders the action button and invokes its handler on click', async () => {
    const manager = createToastManager();
    const onClick = vi.fn();
    render(<Toaster toastManager={manager} />);
    act(() => {
      manager.add({ title: 'File uploaded', actionProps: { children: 'Undo', onClick } });
    });
    const action = await waitFor(() => screen.getByRole('button', { name: 'Undo' }));
    expect(action.className).toContain(styles.action);
    fireEvent.click(action);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('omits the action button when the toast has no actionProps', async () => {
    const manager = createToastManager();
    render(<Toaster toastManager={manager} />);
    act(() => {
      manager.add({ title: 'No action' });
    });
    await waitFor(() => screen.getByRole('dialog'));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('defaults to the shared toast manager when Toaster gets no toastManager prop', async () => {
    render(<Toaster />);
    act(() => {
      toast.add({ title: 'From the shared manager' });
    });
    await waitFor(() => screen.getByText('From the shared manager'));
  });

  it('portals the viewport into a provided container', async () => {
    const manager = createToastManager();
    const container = document.createElement('div');
    container.id = 'themed-section';
    document.body.appendChild(container);
    render(<Toaster toastManager={manager} container={container} />);
    act(() => {
      manager.add({ title: 'Saved' });
    });
    const toastEl = await waitFor(() => screen.getByRole('dialog'));
    expect(container.contains(toastEl)).toBe(true);
    container.remove();
  });
});
