// docs/specs/list-workbench.md AC-6..AC-11: page totals, the export request and CSV, bulk eligibility and plan.
import { describe, expect, it } from 'vitest';
import { reportActions } from '../api/reports.ts';
import type { ActionMeta, AppMeta, EntityMeta, FieldMeta, RecordJson, TableResult } from '../api/types.ts';
import { csvFilename, tableToCsv } from './csv.ts';
import { buildNavigation } from './navigation.ts';
import {
  BULK_LIMIT,
  bulkOps,
  bulkRequest,
  bulkSummary,
  countLabel,
  exportInput,
  FILTERS,
  pageTotals,
  planBulk,
  refreshSelection,
  rowLabel,
  ROWS,
  selectionCriteria,
  togglePageSelection,
  toggleSelection,
  type RowSelectionMap,
} from './list-workbench.ts';

const field = (name: string, kind = 'text', extra: Partial<FieldMeta> = {}): FieldMeta => ({
  name,
  kind,
  label: { ja: name, en: name },
  required: false,
  hasDefault: false,
  hidden: false,
  immutable: false,
  ...extra,
});
const doc: EntityMeta = {
  name: 'sales_invoice',
  kind: 'document',
  label: { ja: '売上請求書', en: 'Sales invoice' },
  module: 'sales',
  scope: 'company',
  displayField: undefined,
  hasExt: false,
  fields: [field('total', 'decimal', { money: true }), field('qty', 'decimal'), field('note')],
  views: { list: ['total', 'qty', 'note'], form: 'auto', search: [] },
  ops: ['read', 'submit', 'cancel', 'delete', 'export'],
};
const row = (id: string, docstatus: 0 | 1 | 2, extra: Record<string, unknown> = {}): RecordJson =>
  ({
    id,
    tenantId: 't',
    companyId: 'c',
    createdAt: '',
    updatedAt: '',
    createdBy: null,
    updatedBy: null,
    version: 3,
    docstatus,
    ...extra,
  }) as RecordJson;

describe('list-workbench AC-6: page totals', () => {
  it('AC-6: sums money columns of the page with decimal strings (no float drift), blanks skipped', () => {
    const rows = [
      row('a', 0, { total: '0.1', qty: '5' }),
      row('b', 0, { total: '0.2' }),
      row('c', 0, { total: null }),
      row('d', 0, { total: '1234567890123.45' }),
    ];
    const totals = pageTotals(rows, doc.fields);
    expect(totals.map((t) => [t.field.name, t.total])).toEqual([['total', '1234567890123.75']]);
    expect(pageTotals(rows.slice(0, 2), doc.fields)[0]?.total).toBe('0.3');
  });
});

describe('list-workbench AC-7: export request and CSV', () => {
  it('AC-7: the export carries the current criteria, order and visible columns (documents lead with number/state)', () => {
    expect(
      exportInput(
        doc,
        { search: ' 商事 ', sort: 'total:desc', where: { docstatus: { $in: [0] } } },
        [doc.fields[1] as FieldMeta, doc.fields[0] as FieldMeta],
        'en',
      ),
    ).toEqual({
      where: { docstatus: { $in: [0] } },
      search: '商事',
      orderBy: [{ field: 'total', dir: 'desc' }],
      columns: ['number', 'docstatus', 'qty', 'total'],
      locale: 'en',
    });
    expect(exportInput({ ...doc, kind: 'entity' }, {}, [doc.fields[2] as FieldMeta], 'ja')).toEqual({
      columns: ['note'],
      locale: 'ja',
    });
    expect(csvFilename('sales_invoice', new Date('2026-10-29T01:02:03Z'))).toBe('sales_invoice_20261029010203.csv');
  });

  it('AC-7: the CSV is UTF-8 with BOM and CRLF; formula-like text cells are neutralised, numbers kept', () => {
    const result: TableResult = {
      title: { ja: '取引先', en: 'Partner' },
      columns: [
        { key: 'name', label: { ja: '名称', en: 'Name' }, kind: 'text' },
        { key: 'amount', label: { ja: '金額', en: 'Amount' }, kind: 'decimal' },
      ],
      rows: [
        { name: '=HYPERLINK("http://example.invalid")', amount: '-1200.5' },
        { name: '+SUM(A1)', amount: '0' },
        { name: '@cmd', amount: null },
        { name: '\t-2+3', amount: '1' },
        { name: '株式会社, "大福"', amount: '10' },
      ],
    };
    const csv = tableToCsv(result, 'ja', '合計');
    expect(csv.startsWith('\uFEFF名称,金額\r\n')).toBe(true);
    expect(csv.split('\r\n').slice(1, 6)).toEqual([
      `"'=HYPERLINK(""http://example.invalid"")",-1200.5`,
      `'+SUM(A1),0`,
      `'@cmd,`,
      `'\t-2+3,1`,
      `"株式会社, ""大福""",10`,
    ]);
  });
});

describe('list-workbench AC-7: export_rows is not a report', () => {
  it('AC-7: generic table actions stay out of the report catalog and the navigation', () => {
    const tableAction = (name: string, generic: boolean): ActionMeta => ({
      name,
      module: name.split('.')[0] ?? '',
      description: { ja: `${name}を返します。`, en: `Return ${name}.` },
      generic,
      mutates: false,
      canExport: true,
      resultKind: 'table',
    });
    const meta: AppMeta = {
      entities: [],
      modules: [],
      roles: ['admin'],
      actions: [tableAction('sales_invoice.export_rows', true), tableAction('sales.ar_aging', false)],
    };
    expect(reportActions(meta).map((a) => a.name)).toEqual(['sales.ar_aging']);
    const hrefs = buildNavigation(meta, false).entries.map((e) => e.href);
    expect(hrefs).toContain('/r/sales.ar_aging');
    expect(hrefs).toContain('/reports');
    expect(hrefs).not.toContain('/r/sales_invoice.export_rows');
    // A role that can only export some entity has no report: no "BI・レポート" link to an empty catalog.
    const exportOnly: AppMeta = { ...meta, actions: [tableAction('sales_invoice.export_rows', true)] };
    expect(reportActions(exportOnly)).toEqual([]);
    expect(buildNavigation(exportOnly, false).entries.map((e) => e.href)).not.toContain('/reports');
  });
});

describe('list-workbench AC-10/AC-11: bulk operations', () => {
  it('AC-10: only documents get bulk operations, limited to the ops the caller has', () => {
    expect(bulkOps(doc)).toEqual(['submit', 'cancel', 'delete']);
    expect(bulkOps({ ...doc, ops: ['read', 'submit'] })).toEqual(['submit']);
    expect(bulkOps({ ...doc, kind: 'entity' })).toEqual([]);
  });

  it('AC-10: rows in a state the operation cannot take are left out and reported', () => {
    const selected = [row('a', 0), row('b', 1), row('c', 0), row('d', 2)];
    expect(planBulk('submit', selected).targets.map((r) => r.id)).toEqual(['a', 'c']);
    expect(planBulk('submit', selected).ineligible.map((r) => r.id)).toEqual(['b', 'd']);
    expect(planBulk('cancel', selected).targets.map((r) => r.id)).toEqual(['b']);
    expect(planBulk('delete', selected).targets.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it(`AC-11: one run takes at most ${BULK_LIMIT} rows`, () => {
    const many = Array.from({ length: BULK_LIMIT + 5 }, (_, i) => row(`r${i}`, 0));
    expect(planBulk('submit', many).targets).toHaveLength(BULK_LIMIT);
  });

  it('AC-10: each row is sent to the existing REST operation with the version the list showed', () => {
    expect(bulkRequest('sales_invoice', 'submit', { id: 'x1', version: 4 })).toEqual({
      path: '/api/sales_invoice/x1/submit',
      method: 'POST',
      body: { expectedVersion: 4 },
    });
    expect(bulkRequest('sales_invoice', 'cancel', { id: 'x1', version: 5 }).path).toBe('/api/sales_invoice/x1/cancel');
    expect(bulkRequest('sales_invoice', 'delete', { id: 'x1', version: 1 })).toEqual({
      path: '/api/sales_invoice/x1',
      method: 'DELETE',
      body: { expectedVersion: 1 },
    });
  });

  it('AC-10: results are counted per row; labels prefer the number, then the display field', () => {
    expect(
      bulkSummary([
        { id: 'a', label: 'A', status: 'done' },
        { id: 'b', label: 'B', status: 'failed', message: 'CONFLICT' },
        { id: 'c', label: 'C', status: 'pending' },
      ]),
    ).toEqual({ done: 1, failed: 1, pending: 1 });
    expect(rowLabel(doc, row('0123456789abcdef', 1, { number: 'INV-2026-000001' }))).toBe('INV-2026-000001');
    expect(rowLabel({ ...doc, displayField: 'note' }, row('0123456789abcdef', 0, { note: '備考' }))).toBe('備考');
    expect(rowLabel(doc, row('0123456789abcdef', 0))).toBe('01234567…');
  });
});

describe('list-workbench AC-11: selection', () => {
  const rows = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => row(`${prefix}${i}`, 0));
  const ids = (selection: RowSelectionMap) => [...selection.keys()];

  it(`AC-11: the selection stops at ${BULK_LIMIT} rows; the next row and the rest of a page are refused`, () => {
    let selection: RowSelectionMap = new Map();
    for (const r of rows('a', BULK_LIMIT)) selection = toggleSelection(selection, r, true);
    expect(selection.size).toBe(BULK_LIMIT);
    const extra = row('extra', 0);
    expect(toggleSelection(selection, extra, true)).toBe(selection);
    expect(togglePageSelection(selection, [extra, row('extra2', 0)], true).size).toBe(BULK_LIMIT);
    // a page larger than the room left is selected in order up to the limit
    const page = togglePageSelection(new Map(), rows('p', BULK_LIMIT + 20), true);
    expect(page.size).toBe(BULK_LIMIT);
    expect(ids(page).at(-1)).toBe(`p${BULK_LIMIT - 1}`);
    // clearing works at the limit, and frees room for another row
    const fewer = toggleSelection(selection, row('a0', 0), false);
    expect(fewer.size).toBe(BULK_LIMIT - 1);
    expect(toggleSelection(fewer, extra, true).has('extra')).toBe(true);
    expect(togglePageSelection(selection, rows('a', 10), false).size).toBe(BULK_LIMIT - 10);
  });

  it('AC-11: a page change keeps the selection; a change of search, sort or filters starts a new one', () => {
    const base = { q: '商事', sort: 'date:desc', where: { docstatus: { $in: [0] } } };
    const key = selectionCriteria(base);
    // the page is not part of the criteria (rows chosen on page 1 stay selected on page 2)
    expect(selectionCriteria({ ...base, page: 2 } as typeof base)).toBe(key);
    expect(selectionCriteria({ ...base, q: '別' })).not.toBe(key);
    expect(selectionCriteria({ ...base, sort: 'date:asc' })).not.toBe(key);
    expect(selectionCriteria({ ...base, where: { docstatus: { $in: [1] } } })).not.toBe(key);
    expect(selectionCriteria({ ...base, where: undefined })).not.toBe(key);
    // rows of page 1 survive the rows of page 2 being shown; selected rows that are shown take the fresh copy
    let selection: RowSelectionMap = togglePageSelection(new Map(), rows('one', 3), true);
    const page2 = rows('two', 3);
    expect(refreshSelection(selection, page2)).toBe(selection);
    selection = toggleSelection(selection, page2[0] as RecordJson, true);
    const fresh = { ...(page2[0] as RecordJson), version: 9, docstatus: 1 as const };
    const refreshed = refreshSelection(selection, [fresh, ...page2.slice(1)]);
    expect(ids(refreshed)).toEqual(['one0', 'one1', 'one2', 'two0']);
    expect(refreshed.get('two0')).toMatchObject({ version: 9, docstatus: 1 });
  });
});

describe('list-workbench AC-12: counts in both languages', () => {
  it('AC-12: English uses singular and plural nouns; Japanese counts with 件', () => {
    expect(countLabel(1, 'en', ROWS)).toBe('1 row');
    expect(countLabel(2, 'en', ROWS)).toBe('2 rows');
    expect(countLabel(1, 'en', FILTERS)).toBe('1 filter');
    expect(countLabel(5000, 'en', ROWS)).toBe('5,000 rows');
    expect(countLabel(3, 'ja', FILTERS)).toBe('3 件');
  });
});
