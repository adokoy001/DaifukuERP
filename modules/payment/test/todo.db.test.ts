// docs/specs/inbox.md AC-1..AC-3: payment.todo counts overdue open invoices and unallocated submitted payments through
// the caller's repository (company scope, direction rowRules, entity read/amend rights). Test DB: TEST_DATABASE_URL*.
import {
  appMeta,
  bootstrapTenant,
  companies,
  newId,
  PermissionDenied,
  registerCrudActions,
  repo,
  runAction,
  todoResult,
  type Context,
  type ContextParams,
  type TodoResult,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Account, openFiscalYear } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaymentModule } from '../src/index.ts';

type Row = Record<string, unknown> & { id: string };
const NOW = new Date('2026-09-10T03:00:00Z'); // 2026-09-10 12:00 JST
let db: TestDb;
let expenseAccount: string;
let customer: string;
let supplier: string;
const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>) =>
  db.run({ now: () => NOW, ...params }, fn);
const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
const todo = async (params: Partial<ContextParams>) =>
  todoResult.parse(await run(params, (ctx) => runAction(ctx, 'payment.todo', {})));
const keys = (result: TodoResult) => result.items.map((item) => [item.key, item.count]);

async function invoice(entity: 'sales_invoice' | 'purchase_invoice', dueDate: string, submit = true): Promise<Row> {
  return run({}, async (ctx) => {
    const created = (await runAction(ctx, `${entity}.create`, {
      partnerId: entity === 'sales_invoice' ? customer : supplier,
      date: '2026-08-01',
      dueDate,
      lines: {
        [`${entity}_line`]: [
          {
            ...(entity === 'purchase_invoice' ? { accountId: expenseAccount } : {}),
            description: '受信箱の試験',
            unitPrice: '3000',
            taxCategory: 'exempt',
          },
        ],
      },
    })) as Row;
    return submit ? ((await runAction(ctx, `${entity}.submit`, { id: created.id })) as Row) : created;
  });
}
async function receipt(amount: string, allocations: { invoiceId: string; amount: string }[], submit = true) {
  return run({}, async (ctx) => {
    const created = (await runAction(ctx, 'payment.create', {
      direction: 'receive',
      partnerId: customer,
      amount,
      lines: { payment_allocation: allocations.map((a) => ({ ...a, invoiceEntity: 'sales_invoice' })) },
    })) as Row;
    return submit ? ((await runAction(ctx, 'payment.submit', { id: created.id })) as Row) : created;
  });
}

beforeAll(async () => {
  if (PaymentModule.name !== 'payment') throw new Error('Payment module not registered');
  registerCrudActions();
  db = await freshDb();
  await run({}, (ctx) => openFiscalYear(ctx, { startDate: '2026-01-01' }));
  const account = (code: string, name: string, type: 'asset' | 'liability' | 'revenue' | 'expense', extra = {}) =>
    run({}, async (ctx) => (await repo(ctx, Account).create({ code, name, type, ...extra })).id);
  await account('1000', '現金', 'asset', { subtype: '現金預金' });
  await account('1100', '普通預金', 'asset', { subtype: '現金預金' });
  await account('1300', '売掛金', 'asset', { subtype: '売掛金', partnerRequired: true });
  await account('2100', '買掛金', 'liability', { subtype: '買掛金', partnerRequired: true });
  await account('2400', '前受金', 'liability', { subtype: 'その他流動負債' });
  await account('1900', '前払金', 'asset', { subtype: 'その他流動資産' });
  await account('4000', '売上高', 'revenue', { subtype: '売上' });
  await account('2200', '仮受消費税', 'liability', { subtype: '仮受消費税' });
  expenseAccount = await account('5000', '仕入高', 'expense', { subtype: '仕入' });
  await account('1500', '仮払消費税', 'asset', { subtype: '仮払消費税' });
  customer = (await run({}, (ctx) => repo(ctx, Partner).create({ name: '得意先T', isCustomer: true }))).id;
  supplier = (await run({}, (ctx) => repo(ctx, Partner).create({ name: '仕入先T', isSupplier: true }))).id;
});
afterAll(async () => {
  await db?.close();
});

describe('payment.todo (docs/specs/inbox.md)', () => {
  it('AC-1 AC-2: overdue open invoices and unallocated submitted payments, zero counts omitted', async () => {
    const accounting = asRole(['accounting']);
    expect(await todo(accounting)).toEqual({ items: [] });
    const overdue = await invoice('sales_invoice', '2026-09-01');
    await invoice('sales_invoice', '2026-09-10'); // due today: not overdue yet
    await invoice('sales_invoice', '2026-08-15', false); // draft: not an open invoice
    await invoice('purchase_invoice', '2026-09-05');
    await receipt('5000', [{ invoiceId: overdue.id, amount: '1000' }]); // 4000 unallocated, invoice still open
    const paid = await invoice('sales_invoice', '2026-08-20');
    await receipt('3000', [{ invoiceId: paid.id, amount: '3000' }]); // fully allocated, invoice paid
    await receipt('700', [], false); // draft payment
    const result = await todo(accounting);
    expect(result.items).toEqual([
      {
        key: 'overdue_sales_invoices',
        label: { ja: '支払期日を過ぎた未入金の売上請求', en: 'Overdue unpaid sales invoices' },
        count: 1,
        href: '/r/payment.outstanding',
        severity: 'warn',
      },
      {
        key: 'overdue_purchase_invoices',
        label: { ja: '支払期日を過ぎた未払の仕入請求', en: 'Overdue unpaid purchase invoices' },
        count: 1,
        href: '/r/payment.outstanding',
        severity: 'warn',
      },
      {
        key: 'unallocated_payments',
        label: { ja: '請求に配分していない入出金（前受・前払）', en: 'Payments with an unallocated amount' },
        count: 1,
        href: '/e/payment?sort=unallocatedAmount:desc',
        severity: 'info',
      },
    ]);
    // The day after the second due date it becomes overdue too.
    const tomorrow = { ...accounting, now: () => new Date('2026-09-11T03:00:00Z') };
    expect(keys(await todo(tomorrow))[0]).toEqual(['overdue_sales_invoices', 2]);
  });

  it('AC-1: each role sees only what its entity rights let it act on', async () => {
    expect(keys(await todo(asRole(['sales'])))).toEqual([['overdue_sales_invoices', 1]]);
    expect(keys(await todo(asRole(['purchasing'])))).toEqual([['overdue_purchase_invoices', 1]]);
    expect(keys(await todo(asRole(['admin'])))).toEqual([
      ['overdue_sales_invoices', 1],
      ['overdue_purchase_invoices', 1],
      ['unallocated_payments', 1],
    ]);
  });

  it('AC-1: another company and another tenant count nothing of this company', async () => {
    const otherCompanyId = newId();
    await db.owner.drizzle
      .insert(companies)
      .values({ id: otherCompanyId, tenantId: db.tenantId, code: 'OTHER', name: '別会社' });
    const other = await bootstrapTenant(db.owner, {
      tenantName: 'Other inbox tenant',
      companyCode: 'OT',
      companyName: '別テナント',
      adminEmail: 'other-inbox@example.com',
      adminName: 'Other',
      adminPassword: 'test-password',
    });
    for (const scope of [{ companyId: otherCompanyId }, { tenantId: other.tenantId, companyId: other.companyId }])
      expect(await todo({ ...asRole(['accounting']), ...scope })).toEqual({ items: [] });
  });

  it('AC-3: viewers and unrelated roles are refused and do not see the provider in /meta', async () => {
    for (const roles of [['viewer'], ['workforce_manager']]) {
      await expect(todo(asRole(roles))).rejects.toBeInstanceOf(PermissionDenied);
      expect(await run(asRole(roles), async (ctx) => appMeta(ctx).actions.map((a) => a.name))).not.toContain(
        'payment.todo',
      );
    }
    const storeScoped = { ...asRole(['sales']), accessScope: 'stores' as const, storeIds: [newId()] };
    await expect(todo(storeScoped)).rejects.toBeInstanceOf(PermissionDenied);
  });
});
