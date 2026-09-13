import assert from 'node:assert/strict';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import {
  newId,
  repo,
  runAction,
  registry,
  registerCrudActions,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { Account, FiscalPeriod, openFiscalYear, createAndSubmitEntry } from '@daifuku/mod-accounting';
import { FilingAccountingPack, type FilingDetail, type FilingExport, type FilingBoard } from '@daifuku/mod-tax-filing';
import '../src/index.ts';
let db: TestDb;
const run = <T>(fn: (ctx: Context) => Promise<T>, params: Partial<ContextParams> = {}) =>
  db.run({ now: () => new Date('2027-01-20T00:00:00Z'), ...params }, fn);
const action = <T = { id: string; version: number }>(
  name: string,
  input: unknown,
  params: Partial<ContextParams> = {},
) => run((ctx) => runAction(ctx, 'tax_filing.' + name, input), params) as Promise<T>;
const reviewer = () => ({ actor: { type: 'user' as const, id: newId() }, roles: ['accounting', 'workforce_payroll'] });
beforeEach(async () => {
  registerCrudActions();
  db = await freshDb();
});
afterEach(async () => {
  await db.close();
});
async function accountingFixture(close = true) {
  const data = await run(async (ctx) => {
    const cash = await repo(ctx, Account).create({ code: '100', name: '普通預金', type: 'asset' });
    const capital = await repo(ctx, Account).create({ code: '300', name: '資本金', type: 'equity' });
    const sales = await repo(ctx, Account).create({ code: '400', name: '売上高', type: 'revenue' });
    const year = await openFiscalYear(ctx, { startDate: '2026-01-01' });
    await createAndSubmitEntry(ctx, { date: '2026-01-01' }, [
      { accountId: cash.id, debit: '1000', credit: '0' },
      { accountId: capital.id, debit: '0', credit: '1000' },
    ]);
    await createAndSubmitEntry(ctx, { date: '2026-12-20' }, [
      { accountId: cash.id, debit: '300', credit: '0' },
      { accountId: sales.id, debit: '0', credit: '300', taxCategory: 'out_of_scope' },
    ]);
    if (close) for (const period of year.periods) await repo(ctx, FiscalPeriod).update(period.id, { isClosed: true });
    return { cash, capital, sales, year };
  });
  const profile = {
    expectedVersion: 0,
    countryProfile: 'jp-hot010-general-v3',
    entityType: 'corporation',
    accountingBasis: 'tax_exclusive',
    consolidation: 'standalone',
    legalName: '株式会社試験',
    mappings: [
      { accountId: data.cash.id, category: 'current_assets', displayName: '普通預金' },
      { accountId: data.capital.id, category: 'capital', displayName: '資本金' },
      { accountId: data.sales.id, category: 'sales', displayName: '売上高' },
    ],
    basis: '分類確認済み',
  };
  await action('save_accounting_profile', profile);
  const request = {
    fiscalYearId: data.year.fiscalYear.id,
    idempotencyKey: newId(),
    incomeTransferNotPostedConfirmed: true,
    taxClassificationReview: '税区分原資料を照合済み',
  };
  return { ...data, profile, request };
}
describe('filing preparation lifecycle and source integrity', () => {
  it('snapshots posted ledger, requires separate confirmation and exports official CSV only after review', async () => {
    const f = await accountingFixture();
    const created = await action('prepare_accounting', f.request);
    const ref = { kind: 'accounting', id: created.id };
    const detail = await action<FilingDetail>('get', ref);
    expect(detail).toMatchObject({
      status: 'draft',
      stale: false,
      totals: { assets: '1300', netProfit: '300', balanceDifference: '0' },
    });
    expect(detail.sourceCount).toBeGreaterThan(10);
    expect(detail.preparedBy).toBe(db.adminUserId);
    expect(f.year.fiscalYear.isClosed).toBe(false);
    expect(
      (await action<FilingBoard>('board', { kind: 'accounting' })).years.find((y) => y.id === f.year.fiscalYear.id)
        ?.closed,
    ).toBe(true);
    await expect(action('export', { ...ref, expectedVersion: created.version })).rejects.toThrow('確認済み');
    const confirmation = {
      ...ref,
      expectedVersion: created.version,
      reason: '仕訳と原本を確認',
      warningsReviewed: true,
    };
    await expect(action('confirm', confirmation)).rejects.toThrow('作成者以外');
    const confirmed = await action('confirm', confirmation, reviewer());
    const output = await action<FilingExport>('export', { ...ref, expectedVersion: confirmed.version });
    expect(output.officialImport).toBe(true);
    expect(output.files).toHaveLength(2);
    expect(output.sourceHash).toBe(detail.sourceHash);
    await expect(action('cancel', { ...ref, expectedVersion: created.version, reason: '旧版操作' })).rejects.toThrow(
      '変更',
    );
    await expect(
      run((ctx) => repo(ctx, FilingAccountingPack).update(created.id, { status: 'confirmed' })),
    ).rejects.toThrow();
    await expect(run((ctx) => repo(ctx, FilingAccountingPack).delete(created.id))).rejects.toThrow();
  });
  it('detects changed source, retains cancellation history and deduplicates retries', async () => {
    const f = await accountingFixture();
    const created = await action('prepare_accounting', f.request);
    expect(await action('prepare_accounting', f.request)).toEqual(created);
    await expect(action('prepare_accounting', { ...f.request, taxClassificationReview: '異なる根拠' })).rejects.toThrow(
      '再試行キー',
    );
    const confirmed = await action(
      'confirm',
      {
        kind: 'accounting',
        id: created.id,
        expectedVersion: created.version,
        reason: '照合済み',
        warningsReviewed: true,
      },
      reviewer(),
    );
    await run((ctx) => repo(ctx, Account).update(f.cash.id, { name: '現預金' }));
    expect((await action<FilingDetail>('get', { kind: 'accounting', id: created.id })).stale).toBe(true);
    await expect(
      action('export', { kind: 'accounting', id: created.id, expectedVersion: confirmed.version }),
    ).rejects.toThrow('元資料');
    const cancelled = await action('cancel', {
      kind: 'accounting',
      id: created.id,
      expectedVersion: confirmed.version,
      reason: '名称変更後に再作成',
    });
    const next = await action('prepare_accounting', { ...f.request, idempotencyKey: newId(), previousId: created.id });
    expect(next.id).not.toBe(created.id);
    expect((await action<FilingDetail>('get', { kind: 'accounting', id: next.id })).previousId).toBe(created.id);
    expect(
      (await action<FilingBoard>('board', { kind: 'accounting' })).packs.find((p) => p.id === cancelled.id)?.status,
    ).toBe('cancelled');
  });
  it('keeps unclosed or unclassified data reviewable but blocks invalid financial export', async () => {
    const f = await accountingFixture(false);
    const created = await action('prepare_accounting', f.request);
    expect(
      (await action<FilingDetail>('get', { kind: 'accounting', id: created.id })).issues.map((i) => i.code),
    ).toContain('period_open');
    await expect(
      action(
        'confirm',
        {
          kind: 'accounting',
          id: created.id,
          expectedVersion: created.version,
          reason: '締め未完了',
          warningsReviewed: true,
        },
        reviewer(),
      ),
    ).rejects.toThrow('検算エラー');
    await expect(
      action('save_accounting_profile', {
        ...f.profile,
        expectedVersion: 1,
        mappings: [{ accountId: newId(), category: 'current_assets', displayName: '不明科目' }],
      }),
    ).rejects.toThrow('会社内');
  });
  it('denies payroll/accounting role substitution and company/site/relay escapes', async () => {
    const f = await accountingFixture();
    const created = await action('prepare_accounting', f.request);
    await expect(action('board', { kind: 'accounting' }, { roles: ['workforce_payroll'] })).rejects.toThrow();
    await expect(action('board', { kind: 'payroll' }, { roles: ['accounting'] })).rejects.toThrow();
    for (const params of [
      { roles: ['accounting'], accessScope: 'sites' as const, siteIds: [] },
      { roles: ['accounting'], accessScope: 'stores' as const, storeIds: [] },
      { roles: ['relay', 'admin'], actor: { type: 'relay' as const, id: newId() } },
    ])
      await expect(action('get', { kind: 'accounting', id: created.id }, params)).rejects.toThrow();
    await expect(action('get', { kind: 'accounting', id: created.id }, { companyId: newId() })).rejects.toThrow();
  });
  it('reports missing payroll source and facts explicitly and exports a visibly nonofficial preparation sheet', async () => {
    const employee = await run(async (ctx) => {
      const site = await repo(ctx, registry.entity('workforce_site')).create({ code: 'S', name: '店舗' });
      return (await runAction(ctx, 'workforce.register_employee', {
        userId: db.adminUserId,
        siteId: site.id,
        code: 'E',
        name: '試験社員',
        hiredOn: '2026-01-01',
      })) as { id: string };
    });
    const profile = {
      expectedVersion: 0,
      countryProfile: 'jp-payroll-preparation-2026',
      taxYear: 2026,
      legalName: '株式会社試験',
      payerAddress: null,
      payerPhone: null,
      recipients: [
        {
          employeeId: employee.id,
          nameKana: null,
          address: null,
          birthDate: null,
          municipalityCode: null,
          unpaidSalaryAmount: null,
          uncollectedTaxAmount: null,
          evidence: '本人への照会中',
        },
      ],
      basis: '年度対象を点検',
    };
    await action('save_payroll_profile', profile, { roles: ['workforce_payroll'] });
    await expect(action('save_payroll_profile', { ...profile, taxYear: 2025 })).rejects.toThrow('年度');
    const created = await action(
      'prepare_payroll',
      { taxYear: 2026, idempotencyKey: newId(), annualScopeConfirmed: true },
      { roles: ['workforce_payroll'] },
    );
    const detail = await action<FilingDetail>(
      'get',
      { kind: 'payroll', id: created.id },
      { roles: ['workforce_payroll'] },
    );
    expect(detail.officialImport).toBe(false);
    expect(detail.payrollRows[0]).toMatchObject({
      employeeId: employee.id,
      taxablePay: null,
      annualTax: null,
      adjustmentId: null,
    });
    expect(detail.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['recipient_facts_missing', 'payroll_evidence_missing', 'adjustment_missing']),
    );
    const confirmed = await action(
      'confirm',
      {
        kind: 'payroll',
        id: created.id,
        expectedVersion: created.version,
        reason: '未算定と不足内容を確認',
        warningsReviewed: true,
      },
      reviewer(),
    );
    const exported = await action<FilingExport>('export', {
      kind: 'payroll',
      id: created.id,
      expectedVersion: confirmed.version,
    });
    assert(exported.files[0]);
    const csv = Buffer.from(exported.files[0].contentBase64, 'base64').toString('utf8');
    expect(csv).toContain('未算定');
    expect(csv).toContain('支払者所在地');
    expect(csv).toContain('支払者の所在地・連絡先');
    expect(exported.notice).toContain('公式375/eLTAX');
  });
});
