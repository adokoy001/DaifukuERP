import { registerCrudActions, repo, runAction, type Context } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Account, openFiscalYear } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaymentModule } from '../src/index.ts';

type Row = Record<string, unknown> & { id: string };
type Table = { rows: Record<string, unknown>[]; totals?: Record<string, string> };
let db: TestDb;
let expense = '';
const run = <T>(fn: (ctx: Context) => Promise<T>) => db.run({}, fn);
const act = <T = Row>(name: string, input: unknown) => run((ctx) => runAction(ctx, name, input)) as Promise<T>;
beforeAll(async () => {
  expect(PaymentModule.name).toBe('payment');
  registerCrudActions();
  db = await freshDb();
  await run((ctx) => openFiscalYear(ctx, { startDate: '2026-01-01' }));
  for (const [code, type] of [['1000', 'asset'], ['1100', 'asset'], ['1300', 'asset'], ['1500', 'asset'], ['1900', 'asset'], ['2100', 'liability'], ['2200', 'liability'], ['2400', 'liability'], ['4000', 'revenue'], ['5000', 'expense']] as const) {
    const account = await run((ctx) => repo(ctx, Account).create({ code, name: code, type }));
    if (code === '5000') expense = account.id;
  }
});
afterAll(async () => { await db.close(); });

async function cycle(side: 'sales' | 'purchase', reverseDate: string) {
  const partner = await run((ctx) => repo(ctx, Partner).create({ name: `${side}-${reverseDate}`, isCustomer: true, isSupplier: true }));
  const entity = `${side}_invoice`;
  const draft = await act(`${entity}.create`, { partnerId: partner.id, date: '2026-08-01', priceIncludesTax: false, lines: { [`${entity}_line`]: [{ description: 'Service', unitPrice: '1000', taxCategory: 'exempt', ...(side === 'purchase' ? { accountId: expense } : {}) }] } });
  await act(`${entity}.submit`, { id: draft.id });
  const p = await act('payment.create', { direction: side === 'sales' ? 'receive' : 'pay', partnerId: partner.id, date: '2026-09-02', amount: '400', lines: { payment_allocation: [{ invoiceEntity: entity, invoiceId: draft.id, amount: '400' }] } });
  await act('payment.submit', { id: p.id });
  await act('payment.cancel', { id: p.id, correctionDate: reverseDate });
  return { invoice: draft, payment: p, entity, partnerId: partner.id };
}

describe('invoice cancellation effective history', () => {
  for (const side of ['sales', 'purchase'] as const) {
    it(`${side}: refuses cancelling across a surviving payment interval and permits the final reversal date`, async () => {
      const c = await cycle(side, '2026-09-05');
      await expect(act(`${c.entity}.cancel`, { id: c.invoice.id })).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'correctionDate' }] } });
      await expect(act(`${c.entity}.cancel`, { id: c.invoice.id, correctionDate: '2026-09-03' })).rejects.toMatchObject({ code: 'VALIDATION' });
      expect(await act(`${c.entity}.get`, { id: c.invoice.id })).toMatchObject({ docstatus: 1, paidAmount: '0' });
      const cancelled = await act(`${c.entity}.cancel`, { id: c.invoice.id, correctionDate: '2026-09-05' });
      expect(cancelled).toMatchObject({ docstatus: 2, cancelledDate: '2026-09-05' });
      const before = await act<Table>(side === 'sales' ? 'sales.ar_aging' : 'purchase.ap_aging', { asOf: '2026-09-03' });
      expect(before.rows.find((row) => row.partnerId === c.partnerId)).toMatchObject({ [side === 'sales' ? 'total' : 'balance']: '600' });
      const after = await act<Table>(side === 'sales' ? 'sales.ar_aging' : 'purchase.ap_aging', { asOf: '2026-09-06' });
      expect(after.rows.find((row) => row.partnerId === c.partnerId)).toBeUndefined();
    });
    it(`${side}: preserves original-date invoice cancellation when payment and its reversal net to zero on one day`, async () => {
      const c = await cycle(side, '2026-09-02');
      expect(await act(`${c.entity}.cancel`, { id: c.invoice.id })).toMatchObject({ docstatus: 2, cancelledDate: '2026-08-01' });
    });
  }
});
