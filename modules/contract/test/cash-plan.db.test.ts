// Postgres tests for the contract part of docs/specs/cash-forecast.md (D-4 `contract`, AC-7, AC-19): planned contract
// receipts equal what contract.generate_invoices then puts on the invoice (total and due date), a generated period
// leaves the plan (draft or submitted), periods billed before the twelve-month window are only counted as backlog,
// and a missing tax rate fails like generation does. Reads go through the caller's repository.
import {
  newId,
  registerCrudActions,
  repo,
  runAction,
  systemParams,
  withContext,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Partner } from '@daifuku/mod-partner';
import { seedUoms } from '@daifuku/mod-product';
import { TaxModule, TaxRate } from '@daifuku/mod-tax';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contractCashWindowStart,
  ContractModule,
  plannedContractReceipts,
  type ContractCashPlan,
} from '../src/index.ts';

type Row = Record<string, unknown>;
type Generated = { created: { contractId: string; invoiceId: string; total: string }[] };
type InvoiceJson = { id: string; docstatus: number; total: string; dueDate: string | null; date: string };

/** 2026-11-10 12:00 JST. */
const NOW = new Date('2026-11-10T03:00:00Z');
const TODAY = '2026-11-10';
let db: TestDb;
let partnerA: string;
let partnerB: string;
const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>) =>
  db.run({ now: () => NOW, ...params }, fn);
const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });

async function activeContract(head: Row, lines: Row[]): Promise<{ id: string; number: string | null }> {
  return run({}, async (ctx) => {
    const draft = (await runAction(ctx, 'contract.create', {
      partnerId: partnerA,
      title: '資金繰り試験',
      ...head,
      lines: { contract_line: lines },
    })) as { id: string };
    return (await runAction(ctx, 'contract.submit', { id: draft.id })) as { id: string; number: string | null };
  });
}
const plan = (to: string, params: Partial<ContextParams> = {}): Promise<ContractCashPlan> =>
  run(params, (ctx) => plannedContractReceipts(ctx, { today: TODAY, to }));
const receiptsOf = (p: ContractCashPlan, contractId: string) => p.receipts.filter((r) => r.contractId === contractId);
async function generate(period: string, contractId: string, submit: boolean): Promise<InvoiceJson> {
  const result = await run(
    {},
    async (ctx) => (await runAction(ctx, 'contract.generate_invoices', { period, contractId, submit })) as Generated,
  );
  const created = result.created[0];
  if (!created) throw new Error(`nothing generated for ${period}`);
  return run({}, async (ctx) => (await runAction(ctx, 'sales_invoice.get', { id: created.invoiceId })) as InvoiceJson);
}

beforeAll(async () => {
  if (ContractModule.name !== 'contract') throw new Error('Missing module');
  registerCrudActions();
  db = await freshDb();
  await withContext(db.app, systemParams(db.tenantId, db.companyId, { now: () => NOW }), async (ctx) => {
    await seedUoms(ctx);
    await TaxModule.seed?.(ctx);
  });
  await run({}, async (ctx) => {
    await runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2026-01-01' });
    await runAction(ctx, 'account.create', {
      code: '1300',
      name: '売掛金',
      type: 'asset',
      subtype: '売掛金',
      partnerRequired: true,
    });
    await runAction(ctx, 'account.create', { code: '4000', name: '売上高', type: 'revenue', subtype: '売上' });
    await runAction(ctx, 'account.create', {
      code: '2200',
      name: '仮受消費税',
      type: 'liability',
      subtype: '仮受消費税',
    });
  });
  partnerA = (
    await run({}, (ctx) =>
      repo(ctx, Partner).create({
        name: '月末締め翌月末',
        isCustomer: true,
        closingDay: 31,
        paymentMonthOffset: 1,
        paymentDay: 31,
      }),
    )
  ).id;
  partnerB = (
    await run({}, (ctx) =>
      repo(ctx, Partner).create({
        name: '20日締め翌月10日',
        isCustomer: true,
        closingDay: 20,
        paymentMonthOffset: 1,
        paymentDay: 10,
      }),
    )
  ).id;
});
afterAll(async () => {
  await db?.close();
});

describe('planned contract receipts (cash-forecast D-4 contract)', () => {
  it('AC-7: planned total and due date equal the invoice contract.generate_invoices creates; generated periods leave the plan', async () => {
    const contract = await activeContract({ partnerId: partnerB, startDate: '2026-10-15', billingDay: 25 }, [
      { description: '賃料', unitPrice: '100000', taxCategory: 'standard' },
      { description: '飲料', quantity: '3', unitPrice: '1234', taxCategory: 'reduced' },
    ]);
    const before = receiptsOf(await plan('2027-01-31'), contract.id);
    expect(before.map((r) => [r.period, r.billingDate])).toEqual([
      ['2026-10', '2026-10-25'],
      ['2026-11', '2026-11-25'],
      ['2026-12', '2026-12-25'],
      ['2027-01', '2027-01-25'],
    ]);
    expect(before[0]?.contractNumber).toBe(contract.number);
    // draft generation (submit = false)
    const october = await generate('2026-10', contract.id, false);
    expect(october.docstatus).toBe(0);
    expect([october.total, october.dueDate]).toEqual([before[0]?.total.toString(), before[0]?.dueDate]);
    // prorated: 17 of 31 days, unit prices rounded down by the contract: 54,838 + 3 × 676
    expect(before[0]?.subtotal.toString()).toBe('56866');
    // submitted generation (submit = true) posts the invoice
    const november = await generate('2026-11', contract.id, true);
    expect(november.docstatus).toBe(1);
    expect([november.total, november.dueDate]).toEqual([before[1]?.total.toString(), before[1]?.dueDate]);
    const after = receiptsOf(await plan('2027-01-31'), contract.id);
    expect(after.map((r) => r.period)).toEqual(['2026-12', '2027-01']);
  });

  it('AC-7 D-4: periods billed before the twelve-month window are backlog only; the window does not depend on the report start', async () => {
    expect(contractCashWindowStart(TODAY)).toBe('2025-11-01');
    const contract = await activeContract({ startDate: '2025-06-01', billingDay: 1 }, [
      { description: '保守', unitPrice: '50000', taxCategory: 'standard' },
    ]);
    const result = await plan('2026-11-30');
    const receipts = receiptsOf(result, contract.id);
    expect(receipts.map((r) => r.period)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
    expect(receipts.every((r) => r.total.toString() === '55000')).toBe(true);
    // 2025-06 .. 2025-10 (5 months) are older than the window: counted, tax-exclusive, never scheduled
    expect(result.backlog.count).toBe(5);
    expect(result.backlog.subtotal.toString()).toBe('250000');
  });

  it('AC-7: an ended contract stays planned through its end month; arrears bill the next month', async () => {
    const contract = await activeContract(
      { startDate: '2026-09-01', endDate: '2026-12-15', billingDay: 5, billingTiming: 'arrears' },
      [{ description: '清掃', unitPrice: '31000', taxCategory: 'standard' }],
    );
    const receipts = receiptsOf(await plan('2027-03-31'), contract.id);
    expect(receipts.map((r) => [r.period, r.billingDate, r.subtotal.toString()])).toEqual([
      ['2026-09', '2026-10-05', '31000'],
      ['2026-10', '2026-11-05', '31000'],
      ['2026-11', '2026-12-05', '31000'],
      ['2026-12', '2027-01-05', '15000'],
    ]);
  });

  it('AC-14: a caller without contract read gets the repository refusal (nothing bypassed)', async () => {
    await expect(plan('2026-12-31', asRole(['purchasing']))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const accounting = await plan('2026-12-31', asRole(['accounting']));
    expect(accounting.receipts.length).toBeGreaterThan(0);
  });

  it('AC-19: a missing tax rate on a planned billing date fails like generation does', async () => {
    const contract = await activeContract({ startDate: '2026-11-01', billingDay: 1 }, [
      { description: '会費', unitPrice: '10000', taxCategory: 'standard' },
    ]);
    await run({}, async (ctx) => {
      const rates = await repo(ctx, TaxRate).list({ where: { category: 'standard', validTo: null } });
      for (const rate of rates.items) await repo(ctx, TaxRate).update(rate.id, { validTo: '2026-12-31' });
    });
    await expect(plan('2027-01-31')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      run({}, (ctx) => runAction(ctx, 'contract.generate_invoices', { period: '2027-01', contractId: contract.id })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    // periods before the gap still plan
    expect(receiptsOf(await plan('2026-12-31'), contract.id).map((r) => r.period)).toEqual(['2026-11', '2026-12']);
  });
});
