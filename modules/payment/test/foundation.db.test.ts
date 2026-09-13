import { newId, registerCrudActions, repo, runAction, setSetting, type Context } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Account, JournalEntry, JournalLine, openFiscalYear } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { SalesInvoice, SalesSettlement, invoiceBalancesAsOf } from '@daifuku/mod-sales';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Payment, PAYMENT_ACCOUNTS_KEY, paymentAccountsSchema } from '../src/index.ts';

type Row = Record<string, unknown> & { id: string };
let db: TestDb;
let customer: string;
const accounts: Record<string, string> = {};
const run = <T>(fn: (ctx: Context) => Promise<T>) => db.run({}, fn);
const act = <T = Row>(name: string, input: unknown) => run((ctx) => runAction(ctx, name, input)) as Promise<T>;
async function invoice(amount = '1000'): Promise<Row> {
  const draft = await act('sales_invoice.create', {
    partnerId: customer,
    date: '2026-08-01',
    lines: { sales_invoice_line: [{ description: 'Service', unitPrice: amount, taxCategory: 'exempt' }] },
  });
  return act('sales_invoice.submit', { id: draft.id });
}
async function payment(invoiceId: string, amount: string, date = '2026-09-02'): Promise<Row> {
  return act('payment.create', {
    direction: 'receive',
    partnerId: customer,
    date,
    amount,
    lines: { payment_allocation: [{ invoiceEntity: 'sales_invoice', invoiceId, amount }] },
  });
}
async function balanceAt(id: string, date: string): Promise<string> {
  return run(
    async (ctx) =>
      (await invoiceBalancesAsOf(ctx, [await repo(ctx, SalesInvoice).get(id)], date)).get(id)?.toString() ?? 'missing',
  );
}

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  await run((ctx) => openFiscalYear(ctx, { startDate: '2026-01-01' }));
  for (const [code, type] of [
    ['1000', 'asset'],
    ['1100', 'asset'],
    ['1300', 'asset'],
    ['1301', 'asset'],
    ['2100', 'liability'],
    ['2200', 'liability'],
    ['2400', 'liability'],
    ['1900', 'asset'],
    ['4000', 'revenue'],
  ] as const) {
    accounts[code] = (
      await run((ctx) =>
        repo(ctx, Account).create({ code, name: code, type, partnerRequired: code === '1300' || code === '1301' }),
      )
    ).id;
  }
  customer = (await run((ctx) => repo(ctx, Partner).create({ name: 'Original customer', isCustomer: true }))).id;
});
afterAll(async () => db.close());

describe('foundation: source ownership, concurrent settlement and effective history', () => {
  it('checks historical balance beyond the first 500 effective dates', async () => {
    const inv = await invoice();
    await run((ctx) => openFiscalYear(ctx, { startDate: '2027-01-01' }));
    // A complete imported history: 250 apply/reverse pairs, then 1000 paid and reversed.
    // Net paidAmount is zero; the over-application occurs only on the second page.
    await db.owner.sql`insert into sales_settlement (id, tenant_id, company_id, invoice_id, date, amount)
      select gen_random_uuid(), ${db.tenantId}::uuid, ${db.companyId}::uuid, ${inv.id}::uuid,
        date '2026-08-01' + n,
        case when n = 500 then 1000 when n = 501 then -1000 when n % 2 = 0 then 1 else -1 end
      from generate_series(0, 501) as n`;
    const date = new Date(Date.UTC(2026, 7, 501)).toISOString().slice(0, 10);
    const p = await payment(inv.id, '1', date);
    await expect(act('payment.submit', { id: p.id })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await run((ctx) => repo(ctx, SalesInvoice).get(inv.id))).paidAmount.toString()).toBe('0');
    expect(await run((ctx) => repo(ctx, SalesSettlement).count({ invoiceId: inv.id }))).toBe(502);
  });
  it('two concurrent payments cannot both consume the same remaining balance', async () => {
    const inv = await invoice();
    const drafts = await Promise.all([payment(inv.id, '600'), payment(inv.id, '600')]);
    const results = await Promise.allSettled(drafts.map((p) => act('payment.submit', { id: p.id })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const state = await run((ctx) => repo(ctx, SalesInvoice).get(inv.id));
    expect([state.paidAmount.toString(), state.balance.toString()]).toEqual(['600', '400']);
    expect(await run((ctx) => repo(ctx, SalesSettlement).count({ invoiceId: inv.id }))).toBe(1);
    const payments = await run((ctx) => repo(ctx, Payment).list({ where: { id: { $in: drafts.map((p) => p.id) } } }));
    expect(payments.items.filter((p) => p.docstatus === 1)).toHaveLength(1);
    const entries = await run((ctx) =>
      repo(ctx, JournalEntry).list({ where: { sourceEntity: 'payment', sourceId: { $in: drafts.map((p) => p.id) } } }),
    );
    expect(entries.items).toHaveLength(1);
    expect(entries.items[0]?.totalDebit.toString()).toBe('600');
  });

  it('as-of balances retain later payments and their dated cancellation; settlement uses the original control account', async () => {
    const inv = await invoice();
    await run((ctx) =>
      setSetting(ctx, PAYMENT_ACCOUNTS_KEY, paymentAccountsSchema, {
        cash: '1000',
        bank: '1100',
        receivable: '1301',
        payable: '2100',
        advanceReceived: '2400',
        advancePaid: '1900',
      }),
    );
    const draft = await payment(inv.id, '400');
    const posted = await act('payment.submit', { id: draft.id });
    const journal = await run((ctx) =>
      repo(ctx, JournalLine).list({ where: { entryId: String(posted.journalEntryId) } }),
    );
    expect(journal.items.find((l) => l.credit.gt(0))?.accountId).toBe(accounts['1300']);
    expect(await balanceAt(inv.id, '2026-09-01')).toBe('1000');
    expect(await balanceAt(inv.id, '2026-09-03')).toBe('600');
    await act('payment.cancel', { id: draft.id, correctionDate: '2026-09-05' });
    expect(await balanceAt(inv.id, '2026-09-03')).toBe('600');
    expect(await balanceAt(inv.id, '2026-09-06')).toBe('1000');
    const backdated = await payment(inv.id, '700', '2026-09-03');
    await expect(act('payment.submit', { id: backdated.id })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await balanceAt(inv.id, '2026-09-03')).toBe('600');
    expect(await run((ctx) => repo(ctx, SalesSettlement).count({ invoiceId: inv.id }))).toBe(2);
    await expect(
      act('sales_settlement.create', { invoiceId: inv.id, date: '2026-08-01', amount: '1' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('generic edits cannot sever source linkage or forge balances; independent reversal cannot undo a business cancellation', async () => {
    const inv = await invoice();
    for (const patch of [
      { journalEntryId: null },
      { paidAmount: '1000', balance: '0' },
      { controlAccountId: accounts['1301'] },
    ]) {
      await expect(act('sales_invoice.update', { id: inv.id, patch })).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
    }
    await expect(act('accounting.reverse_entry', { id: inv.journalEntryId })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await act('sales_invoice.cancel', { id: inv.id, correctionDate: '2026-09-07' });
    const reversal = await run((ctx) =>
      repo(ctx, JournalEntry).list({ where: { reversalOf: String(inv.journalEntryId) } }),
    );
    expect(reversal.items).toHaveLength(1);
    await expect(act('accounting.reverse_entry', { id: reversal.items[0]?.id })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    expect(await run((ctx) => repo(ctx, JournalEntry).count({ reversalOf: reversal.items[0]?.id }))).toBe(0);
  });

  it('issued snapshots survive partner edits, while unsupported money and oversized documents fail atomically', async () => {
    const inv = await invoice();
    const before = await run((ctx) => repo(ctx, SalesInvoice).get(inv.id));
    await run((ctx) => repo(ctx, Partner).update(customer, { name: `Changed ${newId()}` }));
    const after = await run((ctx) => repo(ctx, SalesInvoice).get(inv.id));
    expect(after.issuedSnapshot).toEqual(before.issuedSnapshot);
    expect(before.issuedSnapshot?.recipient.name).toBe('Original customer');
    await expect(invoice('1.5')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      act('sales_invoice.create', { partnerId: customer, date: '2026-08-01', currency: 'USD' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const count = await run((ctx) => repo(ctx, SalesInvoice).count());
    await expect(
      act('sales_invoice.create', {
        partnerId: customer,
        date: '2026-08-01',
        lines: {
          sales_invoice_line: Array.from({ length: 501 }, () => ({
            description: 'x',
            unitPrice: '1',
            taxCategory: 'exempt',
          })),
        },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await run((ctx) => repo(ctx, SalesInvoice).count())).toBe(count);
  });
});
