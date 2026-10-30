// document-links AC-5/AC-6: declared quick actions — when they show, and the receipt/payment they prefill.
import { describe, expect, it } from 'vitest';
import type { EntityMeta, FieldMeta, Op, RecordJson } from '../api/types.ts';
import { seededLines, seededValues } from './duplicate.ts';
import { QUICK_ACTIONS, quickActionAvailable, quickActionSeed, quickActionsFor } from './quick-actions.ts';
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
function entity(
  name: string,
  kind: 'entity' | 'document',
  fields: FieldMeta[],
  extra: Partial<EntityMeta> = {},
): EntityMeta {
  return {
    name,
    kind,
    label: L(name, name),
    module: name,
    scope: 'company',
    displayField: undefined,
    hasExt: true,
    fields,
    views: { list: [], form: 'auto', search: [] },
    ops: ['read', 'create'],
    ...extra,
  };
}

const salesInvoice = entity('sales_invoice', 'document', [field('partnerId', 'ref'), field('balance', 'decimal')]);
const purchaseInvoice = entity('purchase_invoice', 'document', [
  field('partnerId', 'ref'),
  field('balance', 'decimal'),
]);
const payment = entity(
  'payment',
  'document',
  [
    field('direction', 'enum', { required: true, values: ['receive', 'pay'] }),
    field('partnerId', 'ref', { required: true, ref: 'partner' }),
    field('date', 'date', { required: true, hasDefault: true }),
    field('amount', 'decimal', { required: true, money: true }),
    field('method', 'enum', {
      required: true,
      hasDefault: true,
      defaultValue: 'bank_transfer',
      values: ['bank_transfer'],
    }),
    field('accountId', 'ref', { ref: 'account' }),
  ],
  { lines: [{ entity: 'payment_allocation', parentField: 'paymentId' }], ops: ['read', 'create', 'update'] },
);
const allocation = entity('payment_allocation', 'entity', [
  field('paymentId', 'ref', { required: true, ref: 'payment' }),
  field('seq', 'int', { required: true, hasDefault: true }),
  field('invoiceEntity', 'enum', { required: true, values: ['sales_invoice', 'purchase_invoice'] }),
  field('invoiceId', 'uuid', { required: true }),
  field('amount', 'decimal', { required: true, money: true }),
]);
const all = [salesInvoice, purchaseInvoice, payment, allocation];

function invoice(extra: Partial<RecordJson>): RecordJson {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: 't',
    companyId: 'c',
    createdAt: '',
    updatedAt: '',
    createdBy: null,
    updatedBy: null,
    version: 2,
    docstatus: 1,
    number: 'INV-2026-0001',
    partnerId: '33333333-3333-4333-8333-333333333333',
    date: '2026-10-01',
    balance: '1100',
    ...extra,
  };
}

describe('document-links AC-5/AC-6: quick actions', () => {
  it('AC-6: the declarations name sales_invoice -> record receipt and purchase_invoice -> record payment', () => {
    expect(QUICK_ACTIONS.map((a) => [a.id, a.source, a.target, a.label.ja])).toEqual([
      ['sales_invoice.record_receipt', 'sales_invoice', 'payment', '入金を記録'],
      ['purchase_invoice.record_payment', 'purchase_invoice', 'payment', '支払を記録'],
    ]);
  });

  it('AC-5: shown on a submitted invoice with a balance; not on drafts, cancelled or fully paid invoices', () => {
    expect(quickActionsFor(salesInvoice, invoice({}), all).map((a) => a.id)).toEqual(['sales_invoice.record_receipt']);
    expect(quickActionsFor(purchaseInvoice, invoice({}), all).map((a) => a.id)).toEqual([
      'purchase_invoice.record_payment',
    ]);
    for (const extra of [{ docstatus: 0 as const }, { docstatus: 2 as const }, { balance: '0' }, { balance: null }])
      expect(quickActionsFor(salesInvoice, invoice(extra), all)).toEqual([]);
  });

  it('AC-5/AC-6: hidden without payment create permission, or when payment or its allocation lines are not in /meta', () => {
    const [action] = QUICK_ACTIONS;
    if (!action) throw new Error('no quick action');
    expect(quickActionAvailable(action, all)).toBe(true);
    const readOnly = { ...payment, ops: ['read'] as Op[] };
    expect(quickActionAvailable(action, [salesInvoice, readOnly, allocation])).toBe(false);
    expect(quickActionAvailable(action, [salesInvoice, allocation])).toBe(false);
    expect(quickActionAvailable(action, [salesInvoice, payment])).toBe(false);
    const noLines = { ...payment, lines: [] };
    expect(quickActionAvailable(action, [salesInvoice, noLines, allocation])).toBe(false);
    const noDirection = { ...payment, fields: payment.fields.filter((f) => f.name !== 'direction') };
    expect(quickActionAvailable(action, [salesInvoice, noDirection, allocation])).toBe(false);
  });

  it('AC-5: record receipt prefills direction, partner, outstanding amount, today and the allocation line', () => {
    const [receipt, disbursement] = QUICK_ACTIONS;
    if (!receipt || !disbursement) throw new Error('missing quick actions');
    const source = invoice({});
    const seed = quickActionSeed(receipt, source, '2026-10-29', 'INV-2026-0001');
    expect(seed).toMatchObject({
      entity: 'payment',
      values: { direction: 'receive', partnerId: source.partnerId, date: '2026-10-29', amount: '1100' },
      lines: { payment_allocation: [{ invoiceEntity: 'sales_invoice', invoiceId: source.id, amount: '1100' }] },
      source: { mode: 'quick', entity: 'sales_invoice', id: source.id, title: 'INV-2026-0001', action: receipt.id },
    });
    expect(quickActionSeed(disbursement, source, '2026-10-29', 'x')).toMatchObject({
      values: { direction: 'pay' },
      lines: { payment_allocation: [{ invoiceEntity: 'purchase_invoice' }] },
    });
    // the seeded payment form saves as one create with the allocation as a new line; method keeps its default
    const specs = lineSpecsOf(payment, all);
    const plan = planSave({
      entity: payment,
      mode: 'create',
      record: undefined,
      values: seededValues(payment, seed),
      specs,
      lines: seededLines(specs, seed),
      originalLines: {},
      requiredMessage: 'required',
    });
    expect(plan.hasErrors).toBe(false);
    expect(plan.body).toEqual({
      direction: 'receive',
      partnerId: source.partnerId,
      date: '2026-10-29',
      amount: '1100',
      method: 'bank_transfer',
      lines: { payment_allocation: [{ invoiceEntity: 'sales_invoice', invoiceId: source.id, amount: '1100' }] },
    });
  });
});
