// docs/specs/list-workbench.md AC-6..AC-11: page totals, the export request and CSV, bulk eligibility and plan.
import { describe, expect, it } from 'vitest';
import { reportActions } from '../api/reports.ts';
import type { ActionMeta, AppMeta, EntityMeta, FieldMeta, RecordJson, TableResult } from '../api/types.ts';
import { tableToCsv } from './csv.ts';
import { buildNavigation } from './navigation.ts';
import {
  BULK_LIMIT,
  bulkOps,
  bulkRequest,
  bulkSummary,
  exportFilename,
  exportInput,
  pageTotals,
  planBulk,
  rowLabel,
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
    expect(exportFilename('sales_invoice', new Date('2026-10-29T01:02:03Z'))).toBe('sales_invoice_20261029010203.csv');
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
    expect(hrefs).not.toContain('/r/sales_invoice.export_rows');
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
