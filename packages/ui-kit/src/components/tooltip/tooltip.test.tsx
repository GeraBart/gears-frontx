import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';
import styles from './tooltip.module.css';

afterEach(cleanup);

// delay={0} on the trigger keeps hover-open assertions deterministic with
// real timers — Base UI's own default hover delay is 600ms (see tooltip.md).
function renderTooltip(open?: boolean) {
  return render(
    <Tooltip defaultOpen={open}>
      <TooltipTrigger delay={0}>Hover me</TooltipTrigger>
      <TooltipContent>Saved successfully</TooltipContent>
    </Tooltip>,
  );
}

describe('Tooltip', () => {
  it('renders a trigger and keeps the popup out of the DOM until opened', () => {
    renderTooltip();
    expect(screen.getByRole('button', { name: 'Hover me' })).toBeTruthy();
    expect(screen.queryByText('Saved successfully')).toBeNull();
  });

  it('opens on trigger hover and renders content with kit classes', async () => {
    renderTooltip();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Hover me' }));
    const content = await waitFor(() => screen.getByText('Saved successfully'));
    expect(content.className).toContain(styles.popup);
  });

  it('closes on trigger mouse leave', async () => {
    renderTooltip();
    const trigger = screen.getByRole('button', { name: 'Hover me' });
    fireEvent.mouseEnter(trigger);
    await waitFor(() => screen.getByText('Saved successfully'));
    fireEvent.mouseLeave(trigger);
    await waitFor(() => expect(screen.queryByText('Saved successfully')).toBeNull());
  });

  it('opens on trigger focus', async () => {
    renderTooltip();
    fireEvent.focus(screen.getByRole('button', { name: 'Hover me' }));
    await waitFor(() => expect(screen.queryByText('Saved successfully')).not.toBeNull());
  });

  it('does not open a disabled trigger', async () => {
    render(
      <Tooltip>
        <TooltipTrigger delay={0} disabled>
          Hover me
        </TooltipTrigger>
        <TooltipContent>Saved successfully</TooltipContent>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Hover me' }));
    // Absence can't be `waitFor`-ed positively; give the (skipped) open delay
    // a moment to have fired if the disabled check were broken.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Saved successfully')).toBeNull();
  });

  it('renders the caret inside the popup', async () => {
    renderTooltip(true);
    const content = await waitFor(() => screen.getByText('Saved successfully'));
    expect(content.querySelector(`.${styles.arrow}`)).toBeTruthy();
  });

  it('portals the popup into a provided container', async () => {
    const container = document.createElement('div');
    container.id = 'themed-section';
    document.body.appendChild(container);
    render(
      <Tooltip defaultOpen>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent container={container}>Saved successfully</TooltipContent>
      </Tooltip>,
    );
    const content = await waitFor(() => screen.getByText('Saved successfully'));
    expect(container.contains(content)).toBe(true);
    container.remove();
  });

  it('does not open instantly under a bare TooltipProvider', async () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Saved successfully</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Hover me' });
    fireEvent.mouseEnter(trigger);
    // With a real (non-zero) open delay, Base UI defers to its "hover
    // intent" rest timer, which only arms on a mousemove after entry — a
    // bare mouseenter never opens it (unlike the delay={0} tests above).
    fireEvent.mouseMove(trigger);
    // The design call here (see tooltip.tsx) is that mounting TooltipProvider
    // must not silently speed up opening — Base UI's per-trigger 600ms
    // default should still apply unless a delay is passed explicitly.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByText('Saved successfully')).toBeNull();
    await waitFor(() => expect(screen.queryByText('Saved successfully')).not.toBeNull(), {
      timeout: 800,
    });
  });
});
