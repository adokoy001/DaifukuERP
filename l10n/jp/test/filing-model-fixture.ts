import { newId, repo, runAction, registerCrudActions, type Context, type ContextParams } from '@daifuku/kernel';
import { freshDb } from '@daifuku/kernel/testing';
import { Account, FiscalPeriod, openFiscalYear, createAndSubmitEntry } from '@daifuku/mod-accounting';
import { FilingAccountingPack } from '@daifuku/mod-tax-filing';
import '../src/index.ts';
export async function filingModelFixture(capitalAmount: number, saleAmount: number) {
  registerCrudActions(); const db = await freshDb();
  const run = <T>(fn: (ctx: Context) => Promise<T>, params: Partial<ContextParams> = {}) => db.run({ now: () => new Date('2027-01-20T00:00:00Z'), ...params }, fn);
  const action = <T = { id: string; version: number }>(name: string, input: unknown, params: Partial<ContextParams> = {}) => run((ctx) => runAction(ctx, 'tax_filing.' + name, input), params) as Promise<T>;
  const data = await run(async (ctx) => {
    const cash = await repo(ctx, Account).create({ code: '100', name: '普通預金', type: 'asset' });
    const capital = await repo(ctx, Account).create({ code: '300', name: '資本金', type: 'equity' });
    const sales = await repo(ctx, Account).create({ code: '400', name: '売上高', type: 'revenue' });
    const year = await openFiscalYear(ctx, { startDate: '2026-01-01' });
    await createAndSubmitEntry(ctx, { date: '2026-01-01' }, [{ accountId: cash.id, debit: String(capitalAmount), credit: '0' }, { accountId: capital.id, debit: '0', credit: String(capitalAmount) }]);
    await createAndSubmitEntry(ctx, { date: '2026-12-20' }, [{ accountId: cash.id, debit: String(saleAmount), credit: '0' }, { accountId: sales.id, debit: '0', credit: String(saleAmount), taxCategory: 'out_of_scope' }]);
    for (const period of year.periods) await repo(ctx, FiscalPeriod).update(period.id, { isClosed: true });
    return { cash, capital, sales, year };
  });
  const profile = { countryProfile: 'jp-hot010-general-v3', entityType: 'corporation', accountingBasis: 'tax_exclusive', consolidation: 'standalone', legalName: '株式会社試験', mappings: [{ accountId: data.cash.id, category: 'current_assets', displayName: '普通預金' }, { accountId: data.capital.id, category: 'capital', displayName: '資本金' }, { accountId: data.sales.id, category: 'sales', displayName: '売上高' }], basis: '分類確認済み' };
  await action('save_accounting_profile', { ...profile, expectedVersion: 0 });
  const request = { fiscalYearId: data.year.fiscalYear.id, incomeTransferNotPostedConfirmed: true, taxClassificationReview: '税区分原資料を照合済み' };
  const reviewer = { actor: { type: 'user' as const, id: newId() }, roles: ['accounting'] };
  const evidence = (id: string) => run(async (ctx) => { const row = await repo(ctx, FilingAccountingPack).get(id); return { request: row.request, source: row.source, prepared: row.prepared, sourceHash: row.sourceHash }; });
  return { db, run, action, evidence, profile, request, reviewer, ...data };
}
export type FilingFixture = Awaited<ReturnType<typeof filingModelFixture>>;
