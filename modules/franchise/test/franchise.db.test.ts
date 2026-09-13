import assert from 'node:assert/strict';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { DOCSTATUS, newId, registerCrudActions, repo, runAction, type Context } from '@daifuku/kernel';
import { Account, JournalEntry, openFiscalYear } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { SalesInvoice } from '@daifuku/mod-sales';
import { PurchaseInvoice } from '@daifuku/mod-purchase';
import { Payment } from '@daifuku/mod-payment';
import { seedTaxRates } from '@daifuku/mod-tax';
import { FranchiseAgreement, FranchiseSettlement, type FranchiseBoard } from '../src/index.ts';
let db: TestDb, customer: string, supplier: string, bank: string, expense: string;
const run = <T>(fn: (ctx: Context) => Promise<T>) => db.run({ now: () => new Date('2026-09-12T03:00:00Z') }, fn);
type Result = { id: string; version: number; status: string; invoiceId: string; paymentId: string | null };
const action = (name: string, input: unknown) =>
  run((ctx) => runAction(ctx, 'franchise.' + name, input)) as Promise<Result>;
async function agreement(code: string, direction: 'bill' | 'pay' = 'bill') {
  return run((ctx) =>
    repo(ctx, FranchiseAgreement).create({
      code,
      name: code,
      direction,
      partnerId: direction === 'bill' ? customer : supplier,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      basis: 'net',
      rate: '0.05',
      fixedAmount: '1000',
      rounding: 'down',
      taxCategory: 'standard',
      expenseAccountId: direction === 'pay' ? expense : null,
    }),
  );
}
const generate = (a: { id: string; version: number }, extra = {}) =>
  action('generate', {
    agreementId: a.id,
    expectedAgreementVersion: a.version,
    month: '2026-08',
    grossSales: '110000',
    netSales: '100000',
    sourceReference: '承認済み月次売上表 2026-08',
    date: '2026-08-31',
    dueDate: '2026-09-10',
    ...extra,
  });
beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  await run(async (ctx) => {
    await openFiscalYear(ctx, { startDate: '2026-01-01' });
    await seedTaxRates(ctx);
    const defs = [
      { code: '1000', name: '現金', type: 'asset' },
      { code: '1100', name: '預金', type: 'asset' },
      { code: '1300', name: '売掛金', type: 'asset', partnerRequired: true },
      { code: '2100', name: '買掛金', type: 'liability', partnerRequired: true },
      { code: '2400', name: '前受金', type: 'liability' },
      { code: '1900', name: '前払金', type: 'asset' },
      { code: '4000', name: '売上', type: 'revenue' },
      { code: '5000', name: '費用', type: 'expense' },
      { code: '2200', name: '仮受税', type: 'liability', taxRole: 'output_tax' },
      { code: '1500', name: '仮払税', type: 'asset', taxRole: 'input_tax' },
    ];
    for (const def of defs) {
      const row = await repo(ctx, Account).create(def);
      if (def.code === '1100') bank = row.id;
      if (def.code === '5000') expense = row.id;
    }
    customer = (await repo(ctx, Partner).create({ name: '加盟店', isCustomer: true })).id;
    supplier = (await repo(ctx, Partner).create({ name: '本部', isSupplier: true })).id;
  });
});
afterAll(async () => {
  await db.close();
});
describe('monthly franchise source-owned settlement', () => {
  it('generates exact net-basis fee/tax once under duplicate concurrent requests', async () => {
    const a = await agreement('bill');
    const [one, two] = await Promise.all([generate(a), generate(a)]);
    expect(one.id).toBe(two.id);
    const board = (await run((ctx) => runAction(ctx, 'franchise.board', { settlementId: one.id }))) as FranchiseBoard;
    expect(board).toMatchObject({ fee: '6000', tax: '600', total: '6600', balance: '6600', status: 'invoiced' });
    await expect(generate(a, { netSales: '100001' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(run((ctx) => repo(ctx, FranchiseAgreement).update(a.id, { rate: '0.08' }))).rejects.toThrow(
      '使用済み',
    );
    await expect(run((ctx) => runAction(ctx, 'sales_invoice.cancel', { id: one.invoiceId }))).rejects.toThrow(
      'FC精算画面',
    );
  });
  it('settles once and atomically cancels the linked payment and invoice; permits a new reviewed revision', async () => {
    const a = await agreement('roundtrip'),
      made = await generate(a);
    const request = {
      settlementId: made.id,
      expectedVersion: made.version,
      date: '2026-09-05',
      accountId: bank,
      expectedBalance: '6600',
      method: 'bank_transfer',
    };
    const parallel = await Promise.allSettled([action('settle', request), action('settle', request)]);
    expect(parallel.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const paid = (parallel.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Result>).value;
    await expect(run((ctx) => runAction(ctx, 'payment.cancel', { id: paid.paymentId }))).rejects.toThrow('FC精算画面');
    await expect(
      action('cancel', {
        settlementId: paid.id,
        expectedVersion: paid.version,
        date: '2026-09-01',
        reason: '支払より前の取消は不可',
      }),
    ).rejects.toThrow();
    await run(async (ctx) => {
      expect((await repo(ctx, Payment).get(required(paid.paymentId))).docstatus).toBe(DOCSTATUS.submitted);
      expect((await repo(ctx, FranchiseSettlement).get(paid.id)).status).toBe('paid');
    });
    const cancelled = await action('cancel', {
      settlementId: paid.id,
      expectedVersion: paid.version,
      date: '2026-09-06',
      reason: '売上報告訂正',
    });
    expect(cancelled.status).toBe('cancelled');
    await run(async (ctx) => {
      expect((await repo(ctx, Payment).get(required(paid.paymentId))).docstatus).toBe(DOCSTATUS.cancelled);
      expect((await repo(ctx, SalesInvoice).get(made.invoiceId)).docstatus).toBe(DOCSTATUS.cancelled);
    });
    expect((await generate(a)).id).not.toBe(made.id);
  });
  it('posts a payable fee with an explicit expense account and uses payment allocation', async () => {
    const a = await agreement('pay', 'pay'),
      made = await generate(a);
    expect((await run((ctx) => repo(ctx, PurchaseInvoice).get(made.invoiceId))).total.toString()).toBe('6600');
    const paid = await action('settle', {
      settlementId: made.id,
      expectedVersion: made.version,
      date: '2026-09-05',
      accountId: bank,
      expectedBalance: '6600',
      method: 'bank_transfer',
    });
    expect((await run((ctx) => repo(ctx, Payment).get(required(paid.paymentId)))).direction).toBe('pay');
  });
  it('keeps external partial settlements intact and rolls back an attempted linked cancellation', async () => {
    const a = await agreement('external-payment'),
      made = await generate(a);
    const external = await run(async (ctx) => {
      const p = (await runAction(ctx, 'payment.create', {
        direction: 'receive',
        partnerId: customer,
        date: '2026-09-01',
        amount: '1000',
        method: 'bank_transfer',
        accountId: bank,
        lines: {
          payment_allocation: [{ invoiceEntity: SalesInvoice.name, invoiceId: made.invoiceId, amount: '1000' }],
        },
      })) as { id: string };
      await runAction(ctx, 'payment.submit', { id: p.id });
      return p.id;
    });
    await expect(
      action('settle', {
        settlementId: made.id,
        expectedVersion: made.version,
        date: '2026-09-05',
        accountId: bank,
        expectedBalance: '6600',
        method: 'bank_transfer',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const paid = await action('settle', {
      settlementId: made.id,
      expectedVersion: made.version,
      date: '2026-09-05',
      accountId: bank,
      expectedBalance: '5600',
      method: 'bank_transfer',
    });
    expect((await run((ctx) => repo(ctx, Payment).get(required(paid.paymentId)))).amount.toString()).toBe('5600');
    await expect(
      action('cancel', {
        settlementId: paid.id,
        expectedVersion: paid.version,
        date: '2026-09-06',
        reason: '外部入金が残存',
      }),
    ).rejects.toThrow();
    await run(async (ctx) => {
      expect((await repo(ctx, Payment).get(required(paid.paymentId))).docstatus).toBe(DOCSTATUS.submitted);
      expect((await repo(ctx, Payment).get(external)).docstatus).toBe(DOCSTATUS.submitted);
      expect((await repo(ctx, SalesInvoice).get(made.invoiceId)).paidAmount.toString()).toBe('6600');
    });
  });
  it('isolates agreements and settlement reads by company and does not elevate accounting into sales', async () => {
    const a = await agreement('scope');
    const other = newId();
    await db.owner.sql`insert into companies(id,tenant_id,code,name) values(${other},${db.tenantId},'OTHER','Other')`;
    await expect(db.run({ companyId: other }, (ctx) => repo(ctx, FranchiseAgreement).get(a.id))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      db.run({ roles: ['accounting'], now: () => new Date('2026-09-12T03:00:00Z') }, (ctx) =>
        runAction(ctx, 'franchise.generate', {
          agreementId: a.id,
          expectedAgreementVersion: a.version,
          month: '2026-08',
          grossSales: '1000',
          netSales: '1000',
          sourceReference: '権限検査',
          date: '2026-08-31',
          dueDate: '2026-09-10',
        }),
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await run(async (ctx) => {
      expect((await repo(ctx, FranchiseSettlement).list({ where: { agreementId: a.id } })).items).toHaveLength(0);
    });
  });
  it('filters generic settlement reads to the role direction without revealing the opposite invoice', async () => {
    const bill = await generate(await agreement('direction-bill'));
    const pay = await generate(await agreement('direction-pay', 'pay'));
    for (const [role, allowed, denied] of [
      ['sales', bill, pay],
      ['purchasing', pay, bill],
    ] as const) {
      await db.run({ roles: [role] }, async (ctx) => {
        expect((await repo(ctx, FranchiseSettlement).get(allowed.id)).id).toBe(allowed.id);
        await expect(repo(ctx, FranchiseSettlement).get(denied.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
        const listed = await repo(ctx, FranchiseSettlement).list();
        expect(listed.items.some((row) => row.id === allowed.id)).toBe(true);
        expect(listed.items.some((row) => row.id === denied.id)).toBe(false);
        expect(listed.items.every((row) => row.direction === (role === 'sales' ? 'bill' : 'pay'))).toBe(true);
      });
    }
  });
  it('rejects partial-month contracts, future/inconsistent declarations and unauthorized direct source writes without journals', async () => {
    const a = await agreement('invalid');
    await expect(run((ctx) => repo(ctx, FranchiseAgreement).update(a.id, { fixedAmount: '0.1' }))).rejects.toThrow(
      '整数',
    );
    await run((ctx) => repo(ctx, FranchiseAgreement).update(a.id, { name: '使用前の名称修正' }));
    a.version += 1;
    const before = await run(async (ctx) => (await repo(ctx, JournalEntry).list()).total);
    await expect(generate(a, { grossSales: '99999' })).rejects.toThrow();
    await expect(generate(a, { date: '2026-08-01' })).rejects.toThrow();
    await expect(generate(a, { date: '2026-10-01', dueDate: '2026-10-10' })).rejects.toThrow();
    await expect(run((ctx) => repo(ctx, FranchiseSettlement).create({ month: '2026-08' }))).rejects.toThrow();
    expect(await run(async (ctx) => (await repo(ctx, JournalEntry).list()).total)).toBe(before);
  });
});

function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined);
  return value;
}
