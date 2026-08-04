import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card';
import styles from './card.module.css';

afterEach(cleanup);

function renderCard() {
  return render(
    <Card data-testid="card">
      <CardHeader>
        <CardTitle>Team plan</CardTitle>
        <CardDescription>Billed monthly</CardDescription>
        <CardAction>
          <button type="button">Manage</button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p>5 seats in use</p>
      </CardContent>
      <CardFooter>
        <button type="button">Upgrade</button>
      </CardFooter>
    </Card>,
  );
}

describe('Card', () => {
  it('renders every part with its kit class', () => {
    renderCard();
    expect(screen.getByTestId('card').className).toContain(styles.card);
    expect(screen.getByText('Team plan').className).toContain(styles.cardTitle);
    expect(screen.getByText('Billed monthly').className).toContain(styles.cardDescription);
    expect(screen.getByText('5 seats in use').parentElement?.className).toContain(
      styles.cardContent,
    );
    expect(screen.getByRole('button', { name: 'Manage' }).parentElement?.className).toContain(
      styles.cardAction,
    );
    expect(screen.getByRole('button', { name: 'Upgrade' }).parentElement?.className).toContain(
      styles.cardFooter,
    );
  });

  it('defaults to the default size and switches to sm', () => {
    const { rerender } = render(<Card data-testid="card" />);
    expect(screen.getByTestId('card').className).toContain(styles.sizeDefault);
    rerender(<Card data-testid="card" size="sm" />);
    expect(screen.getByTestId('card').className).toContain(styles.sizeSm);
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(<Card data-testid="card" className="consumer" />);
    const card = screen.getByTestId('card');
    expect(card.className).toContain(styles.card);
    expect(card.className).toContain('consumer');
  });

  it('does not leak the size prop to the DOM as an attribute', () => {
    render(<Card data-testid="card" size="sm" />);
    expect(screen.getByTestId('card').hasAttribute('size')).toBe(false);
  });

  it.each([
    ['CardHeader', CardHeader, styles.cardHeader],
    ['CardTitle', CardTitle, styles.cardTitle],
    ['CardDescription', CardDescription, styles.cardDescription],
    ['CardAction', CardAction, styles.cardAction],
    ['CardContent', CardContent, styles.cardContent],
    ['CardFooter', CardFooter, styles.cardFooter],
  ] as const)('merges a consumer className on %s without dropping the kit class', (_name, Part, kitClass) => {
    render(<Part data-testid="part" className="consumer" />);
    const part = screen.getByTestId('part');
    expect(part.className).toContain(kitClass);
    expect(part.className).toContain('consumer');
  });

  it('places CardHeader in the DOM as the direct parent of CardAction and CardDescription', () => {
    renderCard();
    const header = screen.getByText('Team plan').parentElement;
    expect(header?.className).toContain(styles.cardHeader);
    expect(screen.getByText('Billed monthly').parentElement).toBe(header);
    expect(screen.getByRole('button', { name: 'Manage' }).parentElement?.parentElement).toBe(
      header,
    );
  });

  it('forwards native div props such as onClick to any part', () => {
    const onClick = vi.fn();
    render(
      <Card>
        <CardContent onClick={onClick}>Click me</CardContent>
      </Card>,
    );
    fireEvent.click(screen.getByText('Click me'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
