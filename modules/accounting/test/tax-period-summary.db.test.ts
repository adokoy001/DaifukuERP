// Postgres tests for docs/specs/tax-period-summary.md AC-1..AC-4, AC-6. Test DB: daifuku_test_accounting (TEST_DATABASE_URL*).
// AC-6 replays the October of docs/domain/scenario-kojin.md with the journal lines sales/purchase post for it (the same
// line shapes apps/api/test/scenario.db.test.ts asserts): accounting cannot import those modules (dependency direction).
import { appMeta, newId, PermissionDenied, registerCrudActions, repo, runAction, type Context, type ContextParams } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Partner } from '@daifuku/mod-partner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Account, openFiscalYear, postFromSource, reverseSourceEntry, tableResult, type LineInput } from '../src/index.ts';

type Row = Record<string, unknown>;
type Table = { title: { ja: string; en: string }; columns: { key: string; kind: string }[]; rows: Row[]; totals?: Record<string, string>; meta?: Row };

const FIXED_NOW = new Date('2026-12-31T03:00:00Z');
let db: TestDb;
let customer: string;
let supplier: string;
/** account code -> id (the l10n/jp codes the script posts to). */
const acc: Record<string, string> = {};

const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>) => db.run({ now: () => FIXED_NOW, ...params }, fn);
const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
const id = (code: string): string => acc[code] ?? `missing account ${code}`;
const dr = (code: string, amount: string, extra: Partial<LineInput> = {}): LineInput => ({ accountId: id(code), debit: amount, ...extra });
const cr = (code: string, amount: string, extra: Partial<LineInput> = {}): LineInput => ({ accountId: id(code), credit: amount, ...extra });
const STD = { taxCategory: 'standard', taxRate: '0.1' } as const;
const RED = { taxCategory: 'reduced', taxRate: '0.08' } as const;
const sources = new Map<string, string>();

async function post(date: string, lines: LineInput[], description: string): Promise<string> {
  const sourceId = newId();
  const entry = await run({}, (ctx) => postFromSource(ctx, { sourceEntity: 'test_source', sourceId, date, description, lines }));
  sources.set(entry.id, sourceId);
  return entry.id;
}
const summary = (from: string, to: string, params: Partial<ContextParams> = {}) => run(params, async (ctx) => (await runAction(ctx, 'accounting.tax_period_summary', { from, to })) as Table);
/** Rows as [side, taxCategory, taxRate, taxableAmount, taxAmount, count]. */
const tuples = (t: Table) => t.rows.map((r) => [r.side, r.taxCategory, r.taxRate, r.taxableAmount, r.taxAmount, r.count]);

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  await run({}, (ctx) => openFiscalYear(ctx, { startDate: '2026-01-01' }));
  customer = (await run({}, (ctx) => repo(ctx, Partner).create({ name: '株式会社アルファ', isCustomer: true }))).id;
  supplier = (await run({}, (ctx) => repo(ctx, Partner).create({ name: 'デルタ印刷', isSupplier: true }))).id;
  const chart: [string, string, 'asset' | 'liability' | 'equity' | 'revenue' | 'expense', Row][] = [
    ['1100', '普通預金', 'asset', {}],
    ['1300', '売掛金', 'asset', { partnerRequired: true }],
    ['1500', '仮払消費税', 'asset', { taxRole: 'input_tax' }],
    ['2100', '買掛金', 'liability', { partnerRequired: true }],
    ['2200', '仮受消費税', 'liability', { taxRole: 'output_tax' }],
    ['3000', '元入金', 'equity', {}],
    ['4000', '売上高', 'revenue', { taxCategoryDefault: 'standard' }],
    ['6200', '地代家賃', 'expense', { taxCategoryDefault: 'non_taxable' }],
    ['6960', '広告宣伝費', 'expense', {}],
    ['6970', '接待交際費', 'expense', {}],
    ['6980', '外注費', 'expense', {}],
  ];
  for (const [code, name, type, extra] of chart) acc[code] = (await run({}, (ctx) => repo(ctx, Account).create({ code, name, type, ...extra }))).id;
});
afterAll(async () => {
  await db.close();
});

describe('accounting.tax_period_summary (docs/specs/tax-period-summary.md)', () => {
  it('AC-1 account.taxRole: enum none|output_tax|input_tax, default none, label 消費税の役割; accounting can set it', async () => {
    expect((await run({}, (ctx) => repo(ctx, Account).get(id('1100')))).taxRole).toBe('none');
    expect((await run({}, (ctx) => repo(ctx, Account).get(id('2200')))).taxRole).toBe('output_tax');
    expect((await run({}, (ctx) => repo(ctx, Account).get(id('1500')))).taxRole).toBe('input_tax');
    await expect(run({}, (ctx) => repo(ctx, Account).create({ code: 'X1', name: 'x', type: 'asset', taxRole: 'vat' as never }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'taxRole' }] } });
    const created = await run(asRole(['accounting']), (ctx) => repo(ctx, Account).create({ code: 'X2', name: '仮受消費税（旧）', type: 'liability' }));
    expect(created.taxRole).toBe('none');
    expect((await run(asRole(['accounting']), (ctx) => repo(ctx, Account).update(created.id, { taxRole: 'output_tax' }))).taxRole).toBe('output_tax');
    await run({}, (ctx) => repo(ctx, Account).delete(created.id));
    const field = await run({}, async (ctx) => appMeta(ctx).entities.find((e) => e.name === 'account')?.fields.find((f) => f.name === 'taxRole'));
    expect(field).toMatchObject({ kind: 'enum', label: { ja: '消費税の役割' }, required: true, hasDefault: true, values: ['none', 'output_tax', 'input_tax'] });
  });

  describe('AC-6 台本 10 月分（scenario-kojin.md §消費税の集計）', () => {
    beforeAll(async () => {
      // JE0 and a receipt: lines without a tax category are not part of the summary
      await post('2026-10-01', [dr('1100', '300000'), cr('3000', '300000')], 'JE0 元入金');
      // 売上請求書（税抜、10%）: Dr 1300 税込 / Cr 4000 税抜（明細ごと）/ Cr 2200 税額（税率ごと）
      await post('2026-10-05', [dr('1300', '165000', { partnerId: customer }), cr('4000', '100000', STD), cr('4000', '50000', STD), cr('2200', '15000', STD)], 'INV1');
      await post('2026-10-20', [dr('1300', '33000', { partnerId: customer }), cr('4000', '30000', STD), cr('2200', '3000', STD)], 'INV2');
      await post('2026-10-28', [dr('1300', '64900', { partnerId: customer }), cr('4000', '50000', STD), cr('4000', '9000', STD), cr('2200', '5900', STD)], 'INV3');
      // 仕入・経費請求書（税込入力）: Dr 費用 税抜 / Dr 1500 控除対象 / Dr 費用 控除対象外（税区分なし）/ Cr 2100 税込
      await post('2026-10-08', [dr('6960', '20000', STD), dr('1500', '2000', STD), cr('2100', '22000', { partnerId: supplier })], 'BILL1');
      await post('2026-10-15', [dr('6980', '50000', STD), dr('1500', '3500', STD), dr('6980', '1500', { memo: '控除対象外消費税' }), cr('2100', '55000', { partnerId: supplier })], 'BILL2 免税事業者 70%');
      await post('2026-10-25', [dr('6200', '80000', { taxCategory: 'non_taxable', taxRate: '0' }), cr('2100', '80000', { partnerId: supplier })], 'BILL3 家賃');
      await post('2026-10-30', [dr('6970', '5000', RED), dr('1500', '400', RED), cr('2100', '5400', { partnerId: supplier })], 'BILL4 軽減 8%');
      await post('2026-10-31', [dr('1100', '33000'), cr('1300', '33000', { partnerId: customer })], 'PAY1');
    });

    it('AC-6 売上税額 23,900 / 仕入控除税額 5,900 / 差引 18,000; 非課税家賃 80,000 は non_taxable 行で税額 0; 軽減 8% は別行', async () => {
      const t = await summary('2026-10-01', '2026-10-31', asRole(['viewer']));
      expect(tableResult.safeParse(t).success).toBe(true);
      expect(tuples(t)).toEqual([
        ['売上', 'standard', '0.10', '239000', '23900', 8],
        ['仕入', 'standard', '0.10', '70000', '5500', 4],
        ['仕入', 'reduced', '0.08', '5000', '400', 2],
        ['仕入', 'non_taxable', '0.00', '80000', '0', 1],
      ]);
      expect(t.totals).toEqual({ output_tax_total: '23900', input_tax_total: '5900', net_tax_due: '18000' });
      expect(t.rows.map((r) => r.taxCategoryLabel)).toEqual(['標準税率', '標準税率', '軽減税率', '非課税']);
    });

    it('AC-2 TableResult: title 消費税集計表, columns, meta; viewer/accounting/admin may read, others PERMISSION_DENIED; from > to VALIDATION', async () => {
      const t = await summary('2026-10-01', '2026-10-31', asRole(['accounting']));
      expect(t.title).toEqual({ ja: '消費税集計表 2026-10-01〜2026-10-31', en: 'Consumption tax summary 2026-10-01..2026-10-31' });
      expect(t.columns.map((c) => [c.key, c.kind])).toEqual([
        ['side', 'text'],
        ['taxCategory', 'text'],
        ['taxCategoryLabel', 'text'],
        ['taxRate', 'text'],
        ['taxableAmount', 'decimal'],
        ['taxAmount', 'decimal'],
        ['count', 'int'],
      ]);
      expect(t.meta).toEqual({ from: '2026-10-01', to: '2026-10-31' });
      expect(await summary('2026-10-01', '2026-10-31')).toEqual(t); // admin (default test context)
      await expect(summary('2026-10-01', '2026-10-31', asRole(['nobody']))).rejects.toBeInstanceOf(PermissionDenied);
      await expect(summary('2026-10-31', '2026-10-01')).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'to' }] } });
      await expect(run({}, (ctx) => runAction(ctx, 'accounting.tax_period_summary', { from: '2026-10-01' }))).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(run({}, (ctx) => runAction(ctx, 'accounting.tax_period_summary', { from: '2026-10-01', to: '2026/10/31' }))).rejects.toMatchObject({ code: 'VALIDATION' });
      // a period with no taxed lines is an empty table with zero totals
      expect(await summary('2026-09-01', '2026-09-30')).toMatchObject({ rows: [], totals: { output_tax_total: '0', input_tax_total: '0', net_tax_due: '0' } });
    });
  });

  it('AC-2 dates inclusive, submitted entries only, reversed pairs net to zero, credit notes subtract', async () => {
    const n1 = await post('2026-11-01', [dr('1300', '11000', { partnerId: customer }), cr('4000', '10000', STD), cr('2200', '1000', STD)], 'N1 (from)');
    await post('2026-11-30', [dr('1300', '2200', { partnerId: customer }), cr('4000', '2000', STD), cr('2200', '200', STD)], 'N2 (to)');
    await post('2026-11-20', [dr('2100', '1100', { partnerId: supplier }), cr('6960', '1000', STD), cr('1500', '100', STD)], 'N3 仕入返品');
    await post('2026-12-01', [dr('1300', '5500', { partnerId: customer }), cr('4000', '5000', STD), cr('2200', '500', STD)], 'N4 (after to)');
    await run({}, (ctx) => reverseSourceEntry(ctx, { id: n1, date: '2026-11-15', sourceEntity: 'test_source', sourceId: sources.get(n1) ?? '' }));
    // a draft with tax lines in the period is invisible to the report
    await run({}, (ctx) => runAction(ctx, 'journal_entry.create', { date: '2026-11-10', lines: { journal_line: [dr('1300', '99000', { partnerId: customer }), cr('4000', '90000', STD), cr('2200', '9000', STD)] } }));
    const t = await summary('2026-11-01', '2026-11-30');
    expect(tuples(t)).toEqual([
      ['売上', 'standard', '0.10', '2000', '200', 6],
      ['仕入', 'standard', '0.10', '-1000', '-100', 2],
    ]);
    expect(t.totals).toEqual({ output_tax_total: '200', input_tax_total: '-100', net_tax_due: '300' });
    // the reversal alone (its own day) mirrors N1
    expect(tuples(await summary('2026-11-15', '2026-11-15'))).toEqual([['売上', 'standard', '0.10', '-10000', '-1000', 2]]);
  });

  it('AC-4 仮受/仮払 lines without taxCategory/taxRate are counted under (side, unclassified, "") — nothing silently dropped', async () => {
    await post('2026-12-05', [dr('1300', '1100', { partnerId: customer }), cr('4000', '1000', STD), cr('2200', '100')], 'D1 税区分なしの仮受');
    await post('2026-12-06', [dr('6960', '500', STD), dr('1500', '50', { taxCategory: 'standard' }), cr('2100', '550', { partnerId: supplier })], 'D2 税率なしの仮払');
    await post('2026-12-07', [dr('1300', '3000', { partnerId: customer }), cr('4000', '3000', { taxCategory: 'exempt', taxRate: '0' })], 'D3 輸出免税');
    const t = await summary('2026-12-02', '2026-12-31');
    expect(tuples(t)).toEqual([
      ['売上', 'standard', '0.10', '1000', '0', 1],
      ['売上', 'exempt', '0.00', '3000', '0', 1],
      ['売上', 'unclassified', '', '0', '100', 1],
      ['仕入', 'standard', '0.10', '500', '0', 1],
      ['仕入', 'unclassified', '', '0', '50', 1],
    ]);
    expect(t.rows.find((r) => r.taxCategory === 'unclassified')?.taxCategoryLabel).toBe('未分類');
    expect(t.totals).toEqual({ output_tax_total: '100', input_tax_total: '50', net_tax_due: '50' });
  });
});
