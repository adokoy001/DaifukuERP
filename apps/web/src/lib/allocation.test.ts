import { describe, expect, it } from 'vitest';
import type { ActionMeta, EntityMeta, FieldMeta, RecordJson, TableResult } from '../api/types.ts';
import {
  allocatedInvoiceIds,
  allocationConventionOf,
  allocationRows,
  allocationSummary,
  defaultAllocationAmount,
  outstandingInput,
  outstandingInvoices,
  pickProblem,
  remainingFor,
  savedOverAllocation,
} from './allocation.ts';
import { rowsToPayload, type GridRow } from './lines.ts';
import { lineSpecsOf } from './save.ts';

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
const base = {
  module: 'payment',
  scope: 'company' as const,
  displayField: undefined,
  hasExt: true,
  ops: ['read' as const, 'create' as const],
};

// Shapes as served by GET /meta for modules/payment (entities/payment.ts, payment-allocation.ts).
const payment: EntityMeta = {
  ...base,
  name: 'payment',
  kind: 'document',
  label: L('入出金', 'Payment'),
  fields: [
    field('direction', 'enum', { required: true, values: ['receive', 'pay'] }),
    field('partnerId', 'ref', { required: true, ref: 'partner' }),
    field('amount', 'decimal', { required: true, money: true, scale: 0 }),
  ],
  views: { list: [], form: 'auto', search: [] },
  lines: [{ entity: 'payment_allocation', parentField: 'paymentId' }],
};
const allocation: EntityMeta = {
  ...base,
  name: 'payment_allocation',
  kind: 'entity',
  label: L('消込明細', 'Payment allocation'),
  fields: [
    field('paymentId', 'ref', { required: true, ref: 'payment' }),
    field('seq', 'int', { required: true, hasDefault: true }),
    field('invoiceEntity', 'enum', { required: true, values: ['sales_invoice', 'purchase_invoice'] }),
    field('invoiceId', 'uuid', { required: true }),
    field('amount', 'decimal', { required: true, money: true, scale: 0 }),
  ],
  views: { list: ['seq', 'invoiceEntity', 'invoiceId', 'amount'], form: 'auto', search: [] },
};
const outstanding: ActionMeta = {
  name: 'payment.outstanding',
  module: 'payment',
  description: L('', ''),
  generic: false,
  mutates: false,
  resultKind: 'table',
  inputSchema: {
    type: 'object',
    properties: { direction: { type: 'string' }, partnerId: { type: 'string' } },
    required: ['direction'],
  },
};
const entities = [payment, allocation];
const columns = lineSpecsOf(payment, entities)[0]?.columns ?? [];

function row(amount: string, invoiceId = ''): GridRow {
  return { key: `k-${amount}-${invoiceId}`, values: { invoiceEntity: 'sales_invoice', invoiceId, amount } };
}

describe('AC-1 allocation convention (docs/conventions/ui.md)', () => {
  it('payment + payment_allocation + payment.outstanding match', () => {
    expect(allocationConventionOf(payment, entities, [outstanding])).toEqual({
      lineEntity: 'payment_allocation',
      action: 'payment.outstanding',
      invoiceEntities: ['sales_invoice', 'purchase_invoice'],
      hasAmount: true,
    });
  });

  it('no match without the action (or when it is not a table), the header fields, or a *_allocation line with the line fields', () => {
    expect(allocationConventionOf(payment, entities, [])).toBeUndefined();
    expect(allocationConventionOf(payment, entities, [{ ...outstanding, resultKind: 'other' }])).toBeUndefined();
    expect(
      allocationConventionOf(payment, entities, [
        { ...outstanding, inputSchema: { type: 'object', properties: { foo: {} } } },
      ]),
    ).toBeUndefined();
    expect(
      allocationConventionOf({ ...payment, fields: payment.fields.filter((f) => f.name !== 'direction') }, entities, [
        outstanding,
      ]),
    ).toBeUndefined();
    expect(
      allocationConventionOf(
        { ...payment, lines: [{ entity: 'payment_line', parentField: 'paymentId' }] },
        [payment, { ...allocation, name: 'payment_line' }],
        [outstanding],
      ),
    ).toBeUndefined();
    expect(
      allocationConventionOf(
        payment,
        [payment, { ...allocation, fields: allocation.fields.filter((f) => f.name !== 'invoiceEntity') }],
        [outstanding],
      ),
    ).toBeUndefined();
    expect(allocationConventionOf(payment, [payment], [outstanding])).toBeUndefined(); // line entity not readable
    expect(allocationConventionOf({ ...payment, kind: 'entity' }, entities, [outstanding])).toBeUndefined();
  });

  it('the action input comes from the current form values, only once partner and direction are set', () => {
    expect(outstandingInput({ direction: 'receive', partnerId: 'p1', amount: '1' })).toEqual({
      partnerId: 'p1',
      direction: 'receive',
    });
    expect(outstandingInput({ direction: '', partnerId: 'p1' })).toBeUndefined();
    expect(outstandingInput({ direction: 'receive' })).toBeUndefined();
  });
});

describe('AC-1 outstanding TableResult -> pickable invoices', () => {
  const result: TableResult = {
    title: L('未入金の売上請求書', 'Outstanding sales invoices'),
    columns: [
      { key: 'number', label: L('番号', 'Number'), kind: 'text' },
      { key: 'balance', label: L('残高', 'Balance'), kind: 'decimal' },
      { key: 'invoiceId', label: L('請求書', 'Invoice'), kind: 'ref', ref: 'sales_invoice' },
    ],
    rows: [
      {
        invoiceId: 'i1',
        number: 'INV-2026-000001',
        date: '2026-09-01',
        dueDate: '2026-10-31',
        total: '1100',
        paidAmount: '0',
        balance: '1100',
      },
      { invoiceId: 'i2', number: 'INV-2026-000002', date: '2026-09-02', dueDate: null, balance: '550.5' },
      { invoiceId: '', number: 'broken', balance: '1' },
      { invoiceId: 'i3', number: 'no balance', balance: null },
    ],
    meta: { direction: 'receive', invoiceEntity: 'sales_invoice' },
  };
  it('maps number/date/dueDate/balance and the invoice entity from meta; skips rows without id or balance', () => {
    expect(outstandingInvoices(result)).toEqual([
      {
        invoiceId: 'i1',
        invoiceEntity: 'sales_invoice',
        number: 'INV-2026-000001',
        date: '2026-09-01',
        dueDate: '2026-10-31',
        balance: '1100',
      },
      {
        invoiceId: 'i2',
        invoiceEntity: 'sales_invoice',
        number: 'INV-2026-000002',
        date: '2026-09-02',
        dueDate: '',
        balance: '550.5',
      },
    ]);
  });
  it('falls back to the invoiceId column ref when meta has no invoiceEntity', () => {
    const { meta: _m, ...noMeta } = result;
    expect(outstandingInvoices(noMeta)[0]?.invoiceEntity).toBe('sales_invoice');
  });
});

describe('AC-1/AC-2 allocation math (decimal strings, lib/decimal.ts)', () => {
  it('配分合計 / 未配分 and over-allocation', () => {
    expect(allocationSummary('1100', [row('600'), row('500')])).toEqual({
      allocated: '1100',
      unallocated: '0',
      over: false,
    });
    expect(allocationSummary('1000', [row('600.5'), row('400')])).toEqual({
      allocated: '1000.5',
      unallocated: '-0.5',
      over: true,
    });
    expect(allocationSummary('0.3', [row('0.1'), row('0.2')])).toEqual({
      allocated: '0.3',
      unallocated: '0',
      over: false,
    });
    expect(allocationSummary('', [row('10'), row('abc')])).toEqual({
      allocated: '10',
      unallocated: undefined,
      over: false,
    });
    expect(allocationSummary('500', [])).toEqual({ allocated: '0', unallocated: '500', over: false });
  });

  it('default amount = min(balance, remaining unallocated), never negative; balance when no amount is entered', () => {
    expect(defaultAllocationAmount('1100', '5000')).toBe('1100');
    expect(defaultAllocationAmount('1100', '800')).toBe('800');
    expect(defaultAllocationAmount('1100', '0')).toBe('0');
    expect(defaultAllocationAmount('1100', '-50')).toBe('0');
    expect(defaultAllocationAmount('1100.5', undefined)).toBe('1100.5');
    expect(remainingFor('3000', [row('1000')], ['1500'])).toBe('500');
    expect(remainingFor('3000', [], [])).toBe('3000');
    expect(remainingFor('', [row('1000')], [])).toBeUndefined();
    expect(defaultAllocationAmount('1100', remainingFor('3000', [row('1000')], ['1500']))).toBe('500');
  });

  it('a pick amount must be a decimal in (0, balance]', () => {
    expect(pickProblem('1100', '1100')).toBeUndefined();
    expect(pickProblem(' 0.5 ', '1100')).toBeUndefined();
    expect(pickProblem('1100.000001', '1100')).toBe('overBalance');
    expect(pickProblem('0', '1100')).toBe('notPositive');
    expect(pickProblem('-1', '1100')).toBe('notPositive');
    expect(pickProblem('1,000', '1100')).toBe('invalid');
    expect(pickProblem('', '1100')).toBe('invalid');
  });

  it('picks become grid rows (invoiceEntity, invoiceId, amount) that save like typed rows; ids already in the grid are known', () => {
    const invoice = {
      invoiceId: '01a09002-9cbd-752e-867f-6efc3653e03c',
      invoiceEntity: 'sales_invoice',
      number: 'INV-1',
      date: '',
      dueDate: '',
      balance: '1100',
    };
    const rows = allocationRows([{ invoice, amount: ' 1100 ' }], columns);
    expect(columns.map((c) => c.name)).toEqual(['invoiceEntity', 'invoiceId', 'amount']);
    expect(rows).toHaveLength(1);
    expect(rowsToPayload(rows, columns).rows).toEqual([
      { invoiceEntity: 'sales_invoice', invoiceId: invoice.invoiceId, amount: '1100' },
    ]);
    expect(rowsToPayload(rows, columns).errors).toEqual({});
    expect([...allocatedInvoiceIds([...rows, row('1', ''), row('2', 'x')])]).toEqual([invoice.invoiceId, 'x']);
  });

  it('a saved document is over-allocated when Σ lines > amount (the 確定 button)', () => {
    const conv = allocationConventionOf(payment, entities, [outstanding]);
    if (!conv) throw new TypeError('convention expected');
    const rec = (amount: string, amounts: string[]): RecordJson => ({
      id: 'p',
      tenantId: 't',
      companyId: 'c',
      createdAt: '',
      updatedAt: '',
      createdBy: null,
      updatedBy: null,
      version: 1,
      amount,
      lines: {
        payment_allocation: amounts.map((a, i) => ({
          id: `l${i}`,
          tenantId: 't',
          companyId: 'c',
          createdAt: '',
          updatedAt: '',
          createdBy: null,
          updatedBy: null,
          version: 1,
          amount: a,
        })),
      },
    });
    expect(savedOverAllocation(conv, rec('1000', ['600', '400']))).toBe(false);
    expect(savedOverAllocation(conv, rec('1000', ['600', '400.5']))).toBe(true);
    expect(savedOverAllocation(conv, rec('1000', []))).toBe(false);
  });
});
