// document-links AC-1/AC-7: what a copy carries over, how a seed survives router state (only in the session that made
// it), and that a seeded form saves as one create request with new lines only (no ids, numbers, statuses or server-owned
// values).
import { describe, expect, it } from 'vitest';
import type { EntityMeta, FieldMeta, RecordJson } from '../api/types.ts';
import { formFingerprint } from './dirty.ts';
import {
  duplicateSeed,
  isCopyable,
  NOT_COPIED,
  seedFromState,
  seededLines,
  seededValues,
  seedState,
  type DraftSeed,
} from './duplicate.ts';
import { businessToday } from './operations.ts';
import { lineSpecsOf, planSave } from './save.ts';

const L = (ja: string, en: string) => ({ ja, en });
function field(name: string, kind: string, extra: Partial<FieldMeta> = {}): FieldMeta {
  return {
    name,
    kind,
    label: L(name, name),
    required: false,
    hasDefault: false,
    hidden: false,
    immutable: false,
    ...extra,
  };
}
const base = { module: 'sales', scope: 'company' as const, hasExt: true, ops: ['read' as const, 'create' as const] };

// Shapes as GET /meta serves modules/sales (sales-invoice.ts, sales-invoice-line.ts), trimmed.
const invoice: EntityMeta = {
  ...base,
  name: 'sales_invoice',
  kind: 'document',
  label: L('売上請求書', 'Sales invoice'),
  displayField: undefined,
  fields: [
    field('currency', 'enum', {
      required: true,
      hasDefault: true,
      defaultValue: 'JPY',
      immutable: true,
      values: ['JPY'],
    }),
    field('partnerId', 'ref', { required: true, ref: 'partner' }),
    field('date', 'date', { required: true, hasDefault: true }),
    field('dueDate', 'date'),
    field('priceIncludesTax', 'bool', { required: true, hasDefault: true, defaultValue: false }),
    field('total', 'decimal', { serverOwned: true, readOnly: true, money: true }),
    field('status', 'enum', { serverOwned: true, readOnly: true, values: ['draft', 'open', 'paid', 'cancelled'] }),
    field('note', 'text', { multiline: true }),
    field('journalEntryId', 'ref', { serverOwned: true, readOnly: true, ref: 'journal_entry' }),
    field('cancelledDate', 'date', { serverOwned: true, readOnly: true, hidden: true }),
    field('externalCode', 'text', { unique: true }),
    field('createdNote', 'timestamp'),
  ],
  extFields: [field('ext.costCenter', 'text'), field('ext.syncedAt', 'text', { serverOwned: true, readOnly: true })],
  views: { list: [], form: 'auto', search: [] },
  lines: [{ entity: 'sales_invoice_line', parentField: 'invoiceId' }],
};
const line: EntityMeta = {
  ...base,
  name: 'sales_invoice_line',
  kind: 'entity',
  label: L('売上請求明細', 'Sales invoice line'),
  displayField: undefined,
  fields: [
    field('invoiceId', 'ref', { required: true, ref: 'sales_invoice' }),
    field('seq', 'int', { required: true, hasDefault: true }),
    field('description', 'text', { required: true }),
    field('quantity', 'decimal', { required: true, hasDefault: true, defaultValue: '1' }),
    field('unitPrice', 'decimal', { required: true, money: true }),
    field('amount', 'decimal', { serverOwned: true, readOnly: true, money: true }),
  ],
  views: { list: ['description', 'quantity', 'unitPrice', 'amount'], form: 'auto', search: [] },
};
const entities = [invoice, line];

const submitted: RecordJson = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 't',
  companyId: 'c',
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
  createdBy: 'u',
  updatedBy: 'u',
  version: 3,
  docstatus: 1,
  number: 'INV-2026-0007',
  amendedFrom: '22222222-2222-4222-8222-222222222222',
  currency: 'JPY',
  partnerId: '33333333-3333-4333-8333-333333333333',
  date: '2026-09-30',
  dueDate: '2026-10-31',
  priceIncludesTax: true,
  total: '1100',
  status: 'open',
  note: 'Monthly fee',
  journalEntryId: '44444444-4444-4444-8444-444444444444',
  cancelledDate: null,
  externalCode: 'EXT-7',
  createdNote: '2026-09-30T01:00:00Z',
  ext: { costCenter: 'CC-1', syncedAt: '2026-09-30' },
  lines: {
    sales_invoice_line: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        tenantId: 't',
        companyId: 'c',
        createdAt: '',
        updatedAt: '',
        createdBy: null,
        updatedBy: null,
        version: 1,
        invoiceId: '11111111-1111-4111-8111-111111111111',
        seq: 1,
        description: 'Support',
        quantity: '2.000000',
        unitPrice: '500.000000',
        amount: '1000',
      },
    ],
  },
};

describe('document-links AC-1: duplicating a record', () => {
  it('AC-1: copies entered values and lines; leaves out system, server-owned, numbering, status, unique and amendedFrom', () => {
    const seed = duplicateSeed(invoice, submitted, entities, '2026-10-29', 'INV-2026-0007');
    expect(seed.entity).toBe('sales_invoice');
    expect(seed.values).toEqual({
      currency: 'JPY',
      partnerId: submitted.partnerId,
      date: '2026-10-29',
      dueDate: null,
      priceIncludesTax: true,
      note: 'Monthly fee',
    });
    for (const key of ['id', 'version', 'docstatus', 'number', 'amendedFrom', 'status', 'total', 'journalEntryId'])
      expect(seed.values).not.toHaveProperty(key);
    expect(seed.values).not.toHaveProperty('externalCode');
    expect(seed.ext).toEqual({ costCenter: 'CC-1' });
    expect(seed.lines).toEqual({
      sales_invoice_line: [{ description: 'Support', quantity: '2.000000', unitPrice: '500.000000' }],
    });
    expect(seed.source).toEqual({
      mode: 'duplicate',
      entity: 'sales_invoice',
      id: submitted.id,
      title: 'INV-2026-0007',
      date: '2026-09-30',
    });
  });

  it('AC-1: the copyable rule — server-owned, read-only, hidden, unique and timestamp fields are never copied', () => {
    expect(isCopyable(field('note', 'text'))).toBe(true);
    expect(isCopyable(field('currency', 'enum', { immutable: true }))).toBe(true);
    for (const extra of [{ serverOwned: true }, { readOnly: true }, { hidden: true }, { unique: true }])
      expect(isCopyable(field('x', 'text', extra))).toBe(false);
    expect(isCopyable(field('at', 'timestamp'))).toBe(false);
  });

  it('AC-1: line entities the caller cannot read (absent from /meta) are not copied', () => {
    const seed = duplicateSeed(invoice, submitted, [invoice], '2026-10-29', 'INV');
    expect(seed.lines).toEqual({});
  });

  it('AC-1: a seeded form starts clean (baseline = seed) and saves as one create with new lines only', () => {
    const seed = duplicateSeed(invoice, submitted, entities, '2026-10-29', 'INV-2026-0007');
    const specs = lineSpecsOf(invoice, entities);
    const values = seededValues(invoice, seed);
    const lines = seededLines(specs, seed);
    expect(values).toMatchObject({
      partnerId: submitted.partnerId,
      date: '2026-10-29',
      dueDate: '',
      note: 'Monthly fee',
      priceIncludesTax: true,
      'ext.costCenter': 'CC-1',
      'ext.syncedAt': '',
    });
    expect(lines.sales_invoice_line?.[0]?.id).toBeUndefined();
    expect(lines.sales_invoice_line?.[0]?.values).toMatchObject({
      description: 'Support',
      quantity: '2',
      unitPrice: '500',
    });
    const baseline = formFingerprint(values, lines);
    expect(formFingerprint(seededValues(invoice, seed), seededLines(specs, seed))).toBe(baseline);
    expect(formFingerprint({ ...values, note: 'changed' }, lines)).not.toBe(baseline);
    const plan = planSave({
      entity: invoice,
      mode: 'create',
      record: undefined,
      values,
      specs,
      lines,
      originalLines: {},
      requiredMessage: 'required',
    });
    expect(plan.hasErrors).toBe(false);
    expect(plan.body).toEqual({
      currency: 'JPY',
      partnerId: submitted.partnerId,
      date: '2026-10-29',
      priceIncludesTax: true,
      note: 'Monthly fee',
      ext: { costCenter: 'CC-1' },
      lines: { sales_invoice_line: [{ description: 'Support', quantity: '2', unitPrice: '500' }] },
    });
  });

  it('AC-1: a supplier bill number (not unique in the schema, but one specific bill) is not copied', () => {
    expect(NOT_COPIED.purchase_invoice).toEqual(['supplierInvoiceNo']);
    const bill: EntityMeta = {
      ...invoice,
      name: 'purchase_invoice',
      label: L('仕入請求書', 'Purchase invoice'),
      displayField: 'supplierInvoiceNo',
      fields: [field('partnerId', 'ref', { required: true, ref: 'partner' }), field('supplierInvoiceNo', 'text')],
      lines: [],
    };
    const seed = duplicateSeed(bill, { ...submitted, supplierInvoiceNo: 'B-0912' }, [bill], '2026-10-29', 'B-0912');
    expect(seed.values).toEqual({ partnerId: submitted.partnerId });
  });

  it('AC-1: fields the seed leaves out keep their defaults', () => {
    const seed: DraftSeed = { ...duplicateSeed(invoice, submitted, entities, '2026-10-29', 'x'), values: {} };
    expect(seededValues(invoice, seed)).toMatchObject({ currency: 'JPY', priceIncludesTax: false, note: '' });
  });
});

describe('document-links AC-1/AC-7: the seed in router history state', () => {
  const seed = duplicateSeed(invoice, submitted, entities, '2026-10-29', 'INV-2026-0007');
  const owner = 'tenant-1:user-a:company-1';
  it('AC-1: round-trips through history state for the same entity only', () => {
    const state = JSON.parse(JSON.stringify({ key: 'abc', ...seedState(seed, owner) })) as unknown;
    expect(seedFromState(state, 'sales_invoice', owner)).toEqual({ ...seed, owner });
    expect(seedFromState(state, 'payment', owner)).toBeUndefined();
  });
  it('AC-1: a seed is ignored in another session (another user, tenant or company in the same tab) or without one', () => {
    const state = JSON.parse(JSON.stringify(seedState(seed, owner))) as unknown;
    for (const other of ['tenant-1:user-b:company-1', 'tenant-1:user-a:company-2', 'tenant-2:user-a:company-1', ''])
      expect(seedFromState(state, 'sales_invoice', other)).toBeUndefined();
    expect(seedFromState({ draftSeed: seed }, 'sales_invoice', owner)).toBeUndefined();
  });
  it('AC-7: malformed or foreign state is ignored (the page opens without initial values only when no seed was sent)', () => {
    const owned = { ...seed, owner };
    for (const state of [
      undefined,
      null,
      'x',
      {},
      { draftSeed: { ...owned, kind: 'other' } },
      { draftSeed: { ...owned, values: [] } },
      { draftSeed: { ...owned, lines: { sales_invoice_line: ['x'] } } },
      { draftSeed: { ...owned, source: { ...owned.source, mode: 'other' } } },
    ])
      expect(seedFromState(state, 'sales_invoice', owner)).toBeUndefined();
  });
  it('AC-1: today is the business date in Japan time (as the server fills default: today), not the browser zone', () => {
    expect(businessToday(new Date('2026-10-29T14:59:00Z'))).toBe('2026-10-29');
    expect(businessToday(new Date('2026-10-29T15:00:00Z'))).toBe('2026-10-30');
    expect(businessToday(new Date('2026-12-31T15:30:00Z'))).toBe('2027-01-01');
  });
});

describe('recurring-journals AC-3: duplicating an entity with lines (ADR-0031)', () => {
  // Shapes as GET /meta serves modules/accounting recurring_journal / recurring_journal_line, trimmed.
  const template: EntityMeta = {
    ...base,
    module: 'accounting',
    name: 'recurring_journal',
    kind: 'entity',
    label: L('定期仕訳', 'Recurring journal'),
    displayField: 'name',
    fields: [
      field('name', 'text', { required: true }),
      field('kind', 'enum', {
        required: true,
        hasDefault: true,
        defaultValue: 'fixed',
        values: ['fixed', 'allocation'],
      }),
      field('startDate', 'date', { required: true, hasDefault: true }),
      field('endDate', 'date'),
      field('allocationPeriods', 'int'),
      field('nextRunDate', 'date', { serverOwned: true, readOnly: true }),
      field('lastOccurrenceDate', 'date', { serverOwned: true, readOnly: true }),
    ],
    views: { list: [], form: 'auto', search: [] },
    lines: [{ entity: 'recurring_journal_line', parentField: 'templateId' }],
  };
  const templateLine: EntityMeta = {
    ...base,
    module: 'accounting',
    name: 'recurring_journal_line',
    kind: 'entity',
    label: L('定期仕訳明細', 'Recurring journal line'),
    displayField: undefined,
    fields: [
      field('templateId', 'ref', { required: true, ref: 'recurring_journal' }),
      field('seq', 'int', { required: true, hasDefault: true }),
      field('accountId', 'ref', { required: true, ref: 'account' }),
      field('debit', 'decimal', { required: true, hasDefault: true, money: true }),
      field('credit', 'decimal', { required: true, hasDefault: true, money: true }),
      field('memo', 'text'),
    ],
    views: { list: ['accountId', 'debit', 'credit', 'memo'], form: 'auto', search: [] },
  };
  const row = (id: string, values: Record<string, unknown>): RecordJson => ({
    id,
    tenantId: 't',
    companyId: 'c',
    createdAt: '',
    updatedAt: '',
    createdBy: null,
    updatedBy: null,
    version: 1,
    templateId: '66666666-6666-4666-8666-666666666666',
    ...values,
  });
  const generated: RecordJson = {
    ...row('66666666-6666-4666-8666-666666666666', {}),
    name: '前払保険料',
    kind: 'allocation',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    allocationPeriods: 12,
    nextRunDate: '2026-11-30',
    lastOccurrenceDate: '2026-10-31',
    lines: {
      recurring_journal_line: [
        row('77777777-7777-4777-8777-777777777777', {
          seq: 1,
          accountId: 'a1',
          debit: '120000',
          credit: '0',
          memo: 'm',
        }),
        row('88888888-8888-4888-8888-888888888888', {
          seq: 2,
          accountId: 'a2',
          debit: '0',
          credit: '120000',
          memo: null,
        }),
      ],
    },
  };

  it('AC-3: copies the template and its lines; server-owned run dates and line ids are not copied', () => {
    const seed = duplicateSeed(template, generated, [template, templateLine], '2026-10-30', '前払保険料');
    expect(seed.values).toEqual({
      name: '前払保険料',
      kind: 'allocation',
      startDate: '2026-10-30',
      endDate: null,
      allocationPeriods: 12,
    });
    expect(seed.lines).toEqual({
      recurring_journal_line: [
        { accountId: 'a1', debit: '120000', credit: '0', memo: 'm' },
        { accountId: 'a2', debit: '0', credit: '120000', memo: null },
      ],
    });
    const specs = lineSpecsOf(template, [template, templateLine]);
    expect(specs.map((s) => s.line.name)).toEqual(['recurring_journal_line']);
    expect(seededLines(specs, seed).recurring_journal_line?.every((r) => r.id === undefined)).toBe(true);
  });
});
