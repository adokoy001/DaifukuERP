// Postgres tests for docs/specs/close-guide.md AC-1..AC-7 (accounting.close_readiness) against the full runtime: every
// module and pack is registered (../src/modules.ts), so the check sees the same document set as the API. Payment and
// banking depend on accounting, so these cross-module counts can only be exercised here, not in modules/accounting.
// Test DB: TEST_DATABASE_URL_OWNER / TEST_DATABASE_URL. Seeds run in a system context in module order, like
// apps/api/src/db/reset.ts.
import { AUTO_ISSUE_ON_SALES_KEY, AUTO_RECEIPT_ON_PURCHASE_KEY, boolSettingSchema } from '@daifuku/mod-inventory';
import {
  applyPack,
  can,
  companies,
  newId,
  PermissionDenied,
  registry,
  repo,
  runAction,
  setSetting,
  systemParams,
  withContext,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { closeReadinessOutput, FiscalPeriod, JournalEntry, type CloseReadiness } from '@daifuku/mod-accounting';
import { SALES_ISSUER_KEY, salesIssuerSchema } from '@daifuku/mod-sales';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { modules } from '../src/modules.ts';

type Row = Record<string, unknown> & { id: string; version: number };
type ListJson = { items: Row[]; total: number };

/** 2026-10-15 12:00 JST: September has ended, October is the current period. */
const FIXED_NOW = new Date('2026-10-15T03:00:00Z');
const ACCOUNTING = { roles: ['accounting'], actor: { type: 'user' as const, id: newId() } };

let db: TestDb;
let periods: Record<string, string> = {};
let partnerId = '';
let warehouseId = '';
let bankAccountId = '';
let companyB = '';

const run = <T>(fn: (ctx: Context) => Promise<T>, params: Partial<ContextParams> = {}): Promise<T> =>
  db.run({ now: () => FIXED_NOW, ...params }, fn);
const act = <T = Row>(name: string, input: unknown, params: Partial<ContextParams> = {}): Promise<T> =>
  run((ctx) => runAction(ctx, name, input), params) as Promise<T>;
const readiness = async (input: { periodId?: string }, params: Partial<ContextParams> = ACCOUNTING) =>
  closeReadinessOutput.parse(await act('accounting.close_readiness', input, params));
const september = (params?: Partial<ContextParams>) => readiness({ periodId: periods['2026-09'] ?? '' }, params);
const item = (r: CloseReadiness, id: string) => r.items.find((i) => i.id === id);

async function salesInvoice(date: string, amount = '1000'): Promise<Row> {
  return act('sales_invoice.create', {
    partnerId,
    date,
    lines: { sales_invoice_line: [{ description: '締め点検', unitPrice: amount, taxCategory: 'exempt' }] },
  });
}
async function submit(entity: string, id: string): Promise<Row> {
  await act(`${entity}.submit`, { id });
  return act(`${entity}.get`, { id });
}
async function closePeriod(code: string) {
  await act('accounting.close_period', { periodId: periods[code] ?? '' });
}

beforeAll(async () => {
  expect(modules.map((m) => m.name)).toContain('banking');
  db = await freshDb();
  await act('accounting.open_fiscal_year', { startDate: '2026-01-01' });
  for (const m of modules) {
    if (!m.seed) continue;
    await withContext(db.owner, systemParams(db.tenantId, db.companyId, { now: () => FIXED_NOW }), async (ctx) =>
      m.seed?.(ctx),
    );
  }
  await run((ctx) => setSetting(ctx, SALES_ISSUER_KEY, salesIssuerSchema, { name: '締め点検株式会社' }));
  await run((ctx) => setSetting(ctx, AUTO_ISSUE_ON_SALES_KEY, boolSettingSchema, false));
  await run((ctx) => setSetting(ctx, AUTO_RECEIPT_ON_PURCHASE_KEY, boolSettingSchema, false));
  const list = await act<ListJson>('fiscal_period.list', { limit: 100 });
  periods = Object.fromEntries(list.items.map((p) => [String(p.code), p.id]));
  partnerId = (await act('partner.create', { name: '締め点検商事', isCustomer: true, isSupplier: true })).id;
  warehouseId = (await act<ListJson>('warehouse.list', { limit: 1 })).items[0]?.id ?? '';
  const accounts = await act<ListJson>('account.list', { where: { code: '1100' }, limit: 1 });
  const bank = {
    bankCode: '0009',
    branchCode: '001',
    accountType: 'ordinary',
    accountNumber: '9876543',
    holderKana: 'ﾃｽﾄ',
    code: 'MAIN',
    name: '締め点検口座',
    ledgerAccountId: accounts.items[0]?.id,
    requesterCode: '0123456789',
    active: true,
  };
  bankAccountId = (await act('banking.save_account', bank)).id;
  companyB = newId();
  await db.owner.drizzle.insert(companies).values({ id: companyB, tenantId: db.tenantId, code: 'B', name: 'B' });
});
afterAll(async () => {
  await db.close();
});

describe('accounting.close_readiness (docs/specs/close-guide.md)', () => {
  it('AC-1 returns the period, the items and ready to accounting and admin; read-only; other roles are refused', async () => {
    const action = registry.action('accounting.close_readiness');
    expect(action.mutates).toBe(false);
    expect(action.tx).toBe('none');
    const r = await september();
    expect(r.period).toEqual({
      id: periods['2026-09'],
      code: '2026-09',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      isClosed: false,
    });
    expect(r.fiscalYear).toMatchObject({ code: 'FY2026', isClosed: false });
    expect(r).toMatchObject({ defaulted: false, asOf: '2026-10-15', ready: true, blockingCount: 0 });
    for (const i of r.items) {
      expect(i.label.ja.length > 0 && i.label.en.length > 0, i.id).toBe(true);
      expect(Number.isInteger(i.count) && i.count >= 0, i.id).toBe(true);
    }
    expect((await september({})).period.code).toBe('2026-09');
    await expect(
      act('accounting.close_readiness', {}, { roles: ['sales'], actor: { type: 'user', id: newId() } }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('AC-2 AC-3 AC-6 a draft sales invoice in the period blocks (1, ready false) until it is submitted (0, ready true)', async () => {
    const draft = await salesInvoice('2026-09-15');
    const outside = await salesInvoice('2026-10-02');
    const before = await september();
    expect(item(before, 'draft:sales_invoice')).toEqual({
      id: 'draft:sales_invoice',
      kind: 'draft',
      label: { ja: '売上請求書の下書き', en: 'Sales invoice drafts' },
      count: 1,
      blocking: true,
      href: '/e/sales_invoice',
      entity: 'sales_invoice',
      filter: { status: 'draft', field: 'date', from: '2026-09-01', to: '2026-09-30' },
    });
    expect(before).toMatchObject({ ready: false, blockingCount: 1 });
    expect(before.items[0]?.blocking).toBe(true);
    await submit('sales_invoice', draft.id);
    const after = await september();
    expect(item(after, 'draft:sales_invoice')?.count).toBe(0);
    expect(after).toMatchObject({ ready: true, blockingCount: 0 });
    const october = await readiness({ periodId: periods['2026-10'] ?? '' });
    expect(item(october, 'draft:sales_invoice')?.count).toBe(1);
    await act('sales_invoice.delete', { id: outside.id, expectedVersion: outside.version });
  });

  it('AC-3 journal drafts block, drafts of documents that post nothing only warn', async () => {
    const entry = await act('journal_entry.create', { date: '2026-09-30', description: '締め点検' });
    const stock = await act('stock_entry.create', { type: 'receipt', date: '2026-09-10', warehouseId });
    const r = await september();
    expect(item(r, 'draft:journal_entry')).toMatchObject({ count: 1, blocking: true, label: { ja: '仕訳の下書き' } });
    expect(r.items[0]?.id).toBe('draft:journal_entry');
    expect(item(r, 'draft:stock_entry')).toMatchObject({ count: 1, blocking: false });
    expect(r).toMatchObject({ ready: false, blockingCount: 1 });
    await act('journal_entry.delete', { id: entry.id, expectedVersion: entry.version });
    const cleared = await september();
    expect(cleared).toMatchObject({ ready: true, blockingCount: 0 });
    expect(item(cleared, 'draft:stock_entry')?.count).toBe(1);
    await act('stock_entry.delete', { id: stock.id, expectedVersion: stock.version });
  });

  it('AC-2 counts through Repository: drafts of another company are not counted', async () => {
    await run((ctx) => repo(ctx, JournalEntry).create({ date: '2026-09-20', description: '別会社' }), {
      companyId: companyB,
    });
    expect(await run((ctx) => repo(ctx, JournalEntry).count({ docstatus: 0 }), { companyId: companyB })).toBe(1);
    expect(item(await september(), 'draft:journal_entry')?.count).toBe(0);
  });

  it('AC-4 submitted payments up to the period end with an unallocated amount are a warning', async () => {
    const advance = await act('payment.create', {
      direction: 'receive',
      partnerId,
      date: '2026-09-20',
      amount: '5000',
      method: 'bank_transfer',
    });
    expect(item(await september(), 'unallocated_payments')?.count).toBe(0);
    await submit('payment', advance.id);
    const later = await act('payment.create', {
      direction: 'receive',
      partnerId,
      date: '2026-10-05',
      amount: '7000',
      method: 'bank_transfer',
    });
    await submit('payment', later.id);
    const r = await september();
    expect(item(r, 'unallocated_payments')).toEqual({
      id: 'unallocated_payments',
      kind: 'unallocated_payment',
      label: {
        ja: '未配分額が残る確定済みの入出金',
        en: 'Submitted payments with an unallocated amount',
      },
      count: 1,
      blocking: false,
      href: '/e/payment',
      entity: 'payment',
    });
    expect(r.ready).toBe(true);
    expect(item(await readiness({ periodId: periods['2026-10'] ?? '' }), 'unallocated_payments')?.count).toBe(2);
  });

  it('AC-4 bank statement lines booked in the period without an active reconciliation are a warning', async () => {
    const csv = [
      'externalId,bookedOn,direction,amount,description',
      'close-1,2026-09-10,receive,1000,入金A',
      'close-2,2026-09-12,receive,2000,入金B',
      'close-3,2026-10-03,receive,3000,入金C',
    ].join('\n');
    const preview = await act<{ previewHash: string }>('banking.preview_import', { bankAccountId, csv });
    await act('banking.import_statement_csv', { bankAccountId, csv, previewHash: preview.previewHash });
    expect(item(await september(), 'unreconciled_bank_statements')).toMatchObject({
      kind: 'unreconciled_statement',
      count: 2,
      blocking: false,
      href: '/finance/banking',
    });
    const invoice = await submit('sales_invoice', (await salesInvoice('2026-09-05')).id);
    const statements = await act<ListJson>('bank_statement.list', { where: { externalId: 'close-1' }, limit: 1 });
    await act('banking.reconcile', {
      requestId: newId(),
      statementId: statements.items[0]?.id,
      targetKind: 'invoice',
      targetId: invoice.id,
      targetVersion: invoice.version,
      expectedBalance: '1000',
      reason: '締め点検',
    });
    const r = await september();
    expect(item(r, 'unreconciled_bank_statements')?.count).toBe(1);
    expect(item(await readiness({ periodId: periods['2026-10'] ?? '' }), 'unreconciled_bank_statements')?.count).toBe(
      1,
    );
    expect(r.ready).toBe(true);
  });

  it('AC-5 warns while the previous period is open; the first period has no previous-period item', async () => {
    expect(item(await september(), 'previous_period_open')).toEqual({
      id: 'previous_period_open',
      kind: 'previous_period',
      label: { ja: '前の会計期間（2026-08）が締まっていない', en: 'Previous period (2026-08) is still open' },
      count: 1,
      blocking: false,
      href: `/finance/close?periodId=${periods['2026-08']}`,
    });
    await closePeriod('2026-08');
    const r = await september();
    expect(item(r, 'previous_period_open')?.count).toBe(0);
    expect(r.ready).toBe(true);
    expect(item(await readiness({ periodId: periods['2026-01'] ?? '' }), 'previous_period_open')).toBeUndefined();
  });

  it('AC-8 (server default) without periodId: the oldest open period that ended before today', async () => {
    expect(await readiness({})).toMatchObject({ defaulted: true, period: { code: '2026-01' } });
    for (const code of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'])
      await closePeriod(code);
    expect((await readiness({})).period.code).toBe('2026-09');
  });

  it('AC-7 leaves out documents the caller cannot read, and pack documents the company has not applied', async () => {
    const admin = await september({});
    const narrow = await september();
    const hidden = registry
      .allEntities()
      .filter((e) => e.kind === 'document' && 'date' in e.config.fields && !registry.hasPack(e.module ?? ''))
      .filter(
        (e) => !can({ roles: ['accounting'], appliedPacks: [] }, e, 'read') && can({ roles: ['admin'] }, e, 'read'),
      )
      .map((e) => `draft:${e.name}`);
    expect(hidden.length).toBeGreaterThan(0);
    for (const id of hidden) {
      expect(item(narrow, id), id).toBeUndefined();
      expect(item(admin, id), id).toBeDefined();
    }
    expect(narrow.items.length).toBeLessThan(admin.items.length);
    const packDocs = registry
      .allEntities()
      .filter((e) => e.kind === 'document' && e.module !== undefined && registry.hasPack(e.module));
    expect(packDocs.map((e) => e.name)).toContain('retail_closing');
    for (const e of packDocs) expect(item(admin, `draft:${e.name}`), e.name).toBeUndefined();
  });

  it('AC-8 lists the report actions the caller can run, with the period dates as input', async () => {
    const r = await september({});
    expect(r.reports.map((report) => report.action)).toEqual([
      'accounting.trial_balance',
      'accounting.general_ledger',
      'accounting.tax_period_summary',
      'sales.ar_aging',
      'purchase.ap_aging',
      'inventory.valuation',
    ]);
    expect(r.reports[0]).toEqual({
      action: 'accounting.trial_balance',
      label: { ja: '試算表', en: 'Trial balance' },
      input: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(r.reports.find((report) => report.action === 'sales.ar_aging')?.input).toEqual({ asOf: '2026-09-30' });
  });

  it('AC-6 a closed period is never ready; reopening restores the check', async () => {
    await closePeriod('2026-09');
    const closed = await september();
    expect(closed.period.isClosed).toBe(true);
    expect(closed).toMatchObject({ ready: false, blockingCount: 0 });
    await act('accounting.reopen_period', { periodId: periods['2026-09'] ?? '' });
    expect(await september()).toMatchObject({ ready: true, period: { isClosed: false } });
    const period = await run((ctx) => repo(ctx, FiscalPeriod).get(periods['2026-09'] ?? ''));
    expect(period.isClosed).toBe(false);
  });

  it('AC-2 AC-7 a pack document is counted once the company applies the pack (last: it changes the company)', async () => {
    expect(registry.hasEntity('farm_work')).toBe(true);
    expect(item(await september({}), 'draft:farm_work')).toBeUndefined();
    await run((ctx) => applyPack(ctx, 'farm'));
    const applied = await september({});
    expect(item(applied, 'draft:farm_work')).toMatchObject({ count: 0, blocking: false, href: '/e/farm_work' });
    expect(item(applied, 'draft:retail_closing')).toBeUndefined();
  });
});
