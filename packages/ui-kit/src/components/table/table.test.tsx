import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './table';
import styles from './table.module.css';

afterEach(cleanup);

function renderTable() {
  return render(
    <Table data-testid="table">
      <TableCaption>A list of recent invoices.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow data-testid="row-1">
          <TableCell>INV001</TableCell>
          <TableCell>Paid</TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell>1</TableCell>
        </TableRow>
      </TableFooter>
    </Table>,
  );
}

describe('Table', () => {
  it('renders the correct native element per part, with its kit class', () => {
    renderTable();
    const table = screen.getByTestId('table');
    expect(table.tagName).toBe('TABLE');
    expect(table.className).toContain(styles.table);

    const row = screen.getByTestId('row-1');
    expect(row.tagName).toBe('TR');
    expect(row.className).toContain(styles.tableRow);
    expect(row.parentElement).toHaveProperty('tagName', 'TBODY');
    expect(row.parentElement?.className).toContain(styles.tableBody);

    const cell = screen.getByText('INV001');
    expect(cell.tagName).toBe('TD');
    expect(cell.className).toContain(styles.tableCell);

    const head = screen.getByText('Invoice');
    expect(head.tagName).toBe('TH');
    expect(head.className).toContain(styles.tableHead);
    expect(head.closest('thead')?.className).toContain(styles.tableHeader);

    const footerCell = screen.getByText('Total');
    expect(footerCell.closest('tfoot')?.className).toContain(styles.tableFooter);

    const caption = screen.getByText('A list of recent invoices.');
    expect(caption.tagName).toBe('CAPTION');
    expect(caption.className).toContain(styles.tableCaption);
  });

  it('wraps the table in a scrollable, keyboard-reachable container', () => {
    // Table renders two elements (see table.tsx): the source's own
    // horizontal-scroll wrapper, plus <table> itself. tabIndex={0} is this
    // kit's own addition over the source, so the scroll region is reachable
    // by keyboard (WCAG 2.1.1), not only by dragging a scrollbar.
    renderTable();
    const table = screen.getByTestId('table');
    const wrapper = table.parentElement;
    expect(wrapper).toHaveProperty('tagName', 'DIV');
    expect(wrapper?.className).toContain(styles.tableContainer);
    expect(wrapper?.getAttribute('tabindex')).toBe('0');
    // Without label the wrapper stays roleless and nameless — the table
    // inside speaks for itself.
    expect(wrapper?.getAttribute('role')).toBeNull();
    expect(wrapper?.getAttribute('aria-label')).toBeNull();
  });

  it('names the focusable scroll wrapper via label', () => {
    render(<Table data-testid="table" label="Quarterly results" />);
    const wrapper = screen.getByTestId('table').parentElement;
    // aria-label on a bare div is ignored by the accname algorithm — the
    // label prop must bring role="region" with it for the name to land.
    expect(wrapper?.getAttribute('role')).toBe('region');
    expect(wrapper?.getAttribute('aria-label')).toBe('Quarterly results');
    expect(screen.getByRole('region', { name: 'Quarterly results' })).toBe(wrapper);
  });

  it.each([
    ['Table', Table, styles.table],
    ['TableHeader', TableHeader, styles.tableHeader],
    ['TableBody', TableBody, styles.tableBody],
    ['TableFooter', TableFooter, styles.tableFooter],
    ['TableCaption', TableCaption, styles.tableCaption],
  ] as const)('merges a consumer className on %s without dropping the kit class', (_name, Part, kitClass) => {
    render(<Part data-testid="part" className="consumer" />);
    const part = screen.getByTestId('part');
    expect(part.className).toContain(kitClass);
    expect(part.className).toContain('consumer');
  });

  it('merges a consumer className on TableRow without dropping the kit class', () => {
    render(
      <table>
        <tbody>
          <TableRow data-testid="part" className="consumer" />
        </tbody>
      </table>,
    );
    const part = screen.getByTestId('part');
    expect(part.className).toContain(styles.tableRow);
    expect(part.className).toContain('consumer');
  });

  it.each([
    ['TableHead', TableHead, styles.tableHead],
    ['TableCell', TableCell, styles.tableCell],
  ] as const)('merges a consumer className on %s without dropping the kit class', (_name, Part, kitClass) => {
    render(
      <table>
        <tbody>
          <tr>
            <Part data-testid="part" className="consumer" />
          </tr>
        </tbody>
      </table>,
    );
    const part = screen.getByTestId('part');
    expect(part.className).toContain(kitClass);
    expect(part.className).toContain('consumer');
  });

  it('forwards native th/td props such as colSpan and scope', () => {
    render(
      <table>
        <tbody>
          <tr>
            <TableHead scope="col" data-testid="head">
              Name
            </TableHead>
            <TableCell colSpan={2} data-testid="cell">
              Value
            </TableCell>
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByTestId('head')).toHaveProperty('scope', 'col');
    expect(screen.getByTestId('cell')).toHaveProperty('colSpan', 2);
  });

  it.each(['selected', 'stale', 'restricted'])(
    'forwards data-state="%s" to TableRow for the row-state style hooks',
    (state) => {
      render(
        <table>
          <tbody>
            <TableRow data-testid="row" data-state={state} />
          </tbody>
        </table>,
      );
      expect(screen.getByTestId('row').getAttribute('data-state')).toBe(state);
    },
  );

  it('applies the compact density class from the density prop', () => {
    render(
      <Table density="compact">
        <TableBody>
          <TableRow>
            <TableCell>a</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('table').className).toContain(styles.densityCompact);
  });

  it('stays density-default without the prop', () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>a</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('table').className).not.toContain(styles.densityCompact);
  });

  it('keeps the table an accessible grid: role=table with the expected row/cell counts', () => {
    // Guards against a wrapper or a display value quietly breaking the
    // table's implicit ARIA roles — none of the parts here use flexbox or
    // grid display, so the browser's default table/row/cell roles survive.
    renderTable();
    expect(screen.getByRole('table').className).toContain(styles.table);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(screen.getAllByRole('cell')).toHaveLength(4);
  });
});
