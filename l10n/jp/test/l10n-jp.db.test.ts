// Postgres tests for docs/specs/l10n-jp.md AC-1, AC-2, AC-6, AC-7 (+ the override wiring of AC-3/AC-4 through the registry).
// Test DB: daifuku_test_l10n (TEST_DATABASE_URL*). Importing ../src registers accounting → tax → l10n_jp in dependency order.
import {
  Decimal,
  auditTrail,
  getCompany,
  getSetting,
  registerCrudActions,
  registry,
  repo,
  setSetting,
  systemParams,
  withContext,
  type Context,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { filingProfiles } from '@daifuku/mod-tax-filing';
import { PAYROLL_RULE_PROVIDERS_OVERRIDE, type PayrollRuleProviders } from '@daifuku/mod-workforce';
import { Account } from '@daifuku/mod-accounting';
import {
  SEED_TAX_RATES,
  TAX_PRICE_INCLUDES_TAX_KEY,
  TAX_ROUNDING_KEY,
  TaxRate,
  taxPriceIncludesTaxSchema,
  taxRoundingSchema,
} from '@daifuku/mod-tax';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EXEMPT_SUPPLIER_CREDIT_RATIO_OVERRIDE,
  INVOICE_HTML_OVERRIDE,
  JP_CHART_OF_ACCOUNTS,
  JapanModule,
  type ExemptSupplierCreditRatioFn,
  type InvoiceHtmlRenderer,
  type InvoiceRenderData,
} from '../src/index.ts';

let db: TestDb;
const seed = () => withContext(db.app, systemParams(db.tenantId, db.companyId), async (ctx) => JapanModule.seed?.(ctx));
const run = <T>(fn: (ctx: Context) => Promise<T>) => db.run({}, fn);
const accountByCode = (code: string) =>
  run(async (ctx) => (await repo(ctx, Account).list({ where: { code } })).items[0]);

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
});
afterAll(async () => {
  await db.close();
});

describe('l10n/jp module (docs/specs/l10n-jp.md)', () => {
  it('AC-6 registers module l10n_jp with no entities, depending on accounting, tax, tax-filing and workforce, with country overrides', () => {
    const m = registry.module('l10n_jp');
    expect(m).toBe(JapanModule);
    expect(m.label).toEqual({ ja: '日本ローカライズ', en: 'Japan localisation' });
    expect([...m.depends]).toEqual(['accounting', 'tax', 'tax_filing', 'workforce']);
    expect(m.entities).toHaveLength(0);
    expect(registry.allEntities().filter((e) => e.module === 'l10n_jp')).toHaveLength(0);
    expect(registry.allActions().filter((a) => a.module === 'l10n_jp')).toHaveLength(0);
    expect(
      registry
        .allModules()
        .map((x) => x.name)
        .sort(),
    ).toEqual(['accounting', 'l10n_jp', 'partner', 'tax', 'tax_filing', 'workforce']);
    expect(filingProfiles().map((p) => p.option.code)).toEqual(['jp-hot010-general-v3', 'jp-payroll-preparation-2026']);
    const payrollProviders = registry.override<PayrollRuleProviders>(PAYROLL_RULE_PROVIDERS_OVERRIDE, () => [])();
    expect(
      payrollProviders.map((provider) => ({ id: provider.id, country: provider.country, currency: provider.currency })),
    ).toEqual([{ id: 'jp-regular', country: 'JP', currency: 'JPY' }]);

    const ratioFallback: ExemptSupplierCreditRatioFn = () => Decimal.zero();
    const ratio = registry.override(EXEMPT_SUPPLIER_CREDIT_RATIO_OVERRIDE, ratioFallback);
    expect(ratio).not.toBe(ratioFallback);
    expect(ratio({ supplierTaxStatus: 'exempt', date: '2026-10-15' }).toString()).toBe('0.7');
    expect(ratio({ supplierTaxStatus: 'exempt', date: '2026-09-15' }).toString()).toBe('0.8');
    expect(ratio({ supplierTaxStatus: 'registered', date: '2026-10-15' }).toString()).toBe('1');

    const htmlFallback: InvoiceHtmlRenderer = () => '<p>default</p>';
    const render = registry.override(INVOICE_HTML_OVERRIDE, htmlFallback);
    expect(render).not.toBe(htmlFallback);
    const data: InvoiceRenderData = {
      issuer: { name: '大福商店', invoiceRegistrationNo: 'T1234567890123' },
      invoice: { number: 'INV-1', date: '2026-09-11', dueDate: null, note: null, priceIncludesTax: false },
      recipient: { name: '株式会社テスト' },
      lines: [
        {
          seq: 1,
          description: '食品',
          quantity: '1',
          unitPrice: '1333',
          amount: '1333',
          taxCategory: 'reduced',
          rate: '0.08',
        },
      ],
      taxSummary: [{ category: 'reduced', rate: '0.08', taxable: '1333', tax: '106', gross: '1439' }],
      totals: { subtotal: '1333', taxTotal: '106', total: '1439' },
      locale: 'ja',
    };
    const html = render(data);
    expect(html).toContain('登録番号 T1234567890123');
    expect(html).toContain('8%対象（軽減税率対象）');
    expect(html).toContain('令和8年9月11日');
  });

  it('AC-1/AC-2/AC-7 seed is idempotent per company and never overwrites what exists', async () => {
    // pre-existing data that the seed must respect
    const cash = await run((ctx) =>
      repo(ctx, Account).create({ code: '1000', name: 'Cash (operator-defined)', type: 'asset', subtype: 'custom' }),
    );
    await run((ctx) => setSetting(ctx, TAX_PRICE_INCLUDES_TAX_KEY, taxPriceIncludesTaxSchema, true));
    expect(await run((ctx) => repo(ctx, Account).count())).toBe(1);
    expect(await run((ctx) => repo(ctx, TaxRate).count())).toBe(0);
    expect((await run(getCompany)).settings[TAX_ROUNDING_KEY]).toBeUndefined();

    await seed();
    const accountsAfterFirst = await run((ctx) => repo(ctx, Account).list({ limit: 100 }));
    expect(accountsAfterFirst.total).toBe(JP_CHART_OF_ACCOUNTS.length);
    expect(await run((ctx) => repo(ctx, TaxRate).count())).toBe(SEED_TAX_RATES.length);
    const company = await run(getCompany);
    expect(company.settings[TAX_ROUNDING_KEY]).toEqual({ mode: 'down', unit: 'invoice' });
    expect(company.settings[TAX_PRICE_INCLUDES_TAX_KEY]).toBe(true); // operator's value kept
    expect(
      await run((ctx) =>
        getSetting(ctx, TAX_ROUNDING_KEY, taxRoundingSchema, { mode: 'half_up', unit: 'delivery_note' }),
      ),
    ).toEqual({ mode: 'down', unit: 'invoice' });
    const kept = await run((ctx) => repo(ctx, Account).get(cash.id));
    expect(kept).toMatchObject({ code: '1000', name: 'Cash (operator-defined)', subtype: 'custom', version: 1 });

    await seed();
    const accountsAfterSecond = await run((ctx) => repo(ctx, Account).list({ limit: 100 }));
    expect(accountsAfterSecond.total).toBe(JP_CHART_OF_ACCOUNTS.length);
    expect(new Set(accountsAfterSecond.items.map((a) => a.id))).toEqual(
      new Set(accountsAfterFirst.items.map((a) => a.id)),
    );
    expect(accountsAfterSecond.items.every((a) => a.version === 1)).toBe(true);
    expect(await run((ctx) => repo(ctx, TaxRate).count())).toBe(SEED_TAX_RATES.length);
    expect((await run(getCompany)).settings).toEqual(company.settings);
    // the second run wrote nothing: one create per seeded account, one settings update in total
    const ar = await accountByCode('1300');
    expect((await run((ctx) => auditTrail(ctx, 'account', ar?.id ?? ''))).map((e) => e.op)).toEqual(['create']);
    expect((await run((ctx) => auditTrail(ctx, 'company_settings', db.companyId))).map((e) => e.op)).toEqual([
      'update',
      'update',
    ]); // operator's + seed's
  });

  it('AC-1 chart of accounts: every spec code with its type, Japanese subtype, partnerRequired and default tax category', async () => {
    const all = await run((ctx) => repo(ctx, Account).list({ limit: 100, orderBy: [{ field: 'code', dir: 'asc' }] }));
    expect(all.items.map((a) => a.code)).toEqual([...JP_CHART_OF_ACCOUNTS.map((a) => a.code)].sort());
    const byCode = new Map(all.items.map((a) => [a.code, a]));
    const pick = (code: string) => {
      const a = byCode.get(code);
      return a
        ? {
            name: a.name,
            type: a.type,
            subtype: a.subtype,
            partnerRequired: a.partnerRequired,
            taxCategoryDefault: a.taxCategoryDefault,
            isActive: a.isActive,
          }
        : undefined;
    };
    expect(pick('1300')).toEqual({
      name: '売掛金',
      type: 'asset',
      subtype: '売掛金',
      partnerRequired: true,
      taxCategoryDefault: null,
      isActive: true,
    });
    expect(pick('2100')).toEqual({
      name: '買掛金',
      type: 'liability',
      subtype: '買掛金',
      partnerRequired: true,
      taxCategoryDefault: null,
      isActive: true,
    });
    expect(pick('1500')).toMatchObject({
      name: '仮払消費税',
      type: 'asset',
      subtype: '仮払消費税',
      partnerRequired: false,
    });
    expect(pick('2200')).toMatchObject({ name: '仮受消費税', type: 'liability', subtype: '仮受消費税' });
    expect(pick('2300')).toMatchObject({ name: '未払消費税', type: 'liability' });
    expect(pick('3000')).toMatchObject({ name: '元入金', type: 'equity', subtype: '元入金' });
    expect(pick('3100')).toMatchObject({ name: '事業主貸', type: 'equity', subtype: '事業主勘定' });
    expect(pick('3200')).toMatchObject({ name: '事業主借', type: 'equity', subtype: '事業主勘定' });
    expect(pick('4000')).toEqual({
      name: '売上高',
      type: 'revenue',
      subtype: '売上',
      partnerRequired: false,
      taxCategoryDefault: 'standard',
      isActive: true,
    });
    expect(pick('4100')).toMatchObject({ name: '雑収入', type: 'revenue', taxCategoryDefault: null });
    expect(pick('5000')).toEqual({
      name: '仕入高',
      type: 'expense',
      subtype: '仕入',
      partnerRequired: false,
      taxCategoryDefault: 'standard',
      isActive: true,
    });
    expect(pick('6100')).toMatchObject({
      name: '給料手当',
      type: 'expense',
      subtype: '販売費及び一般管理費',
      taxCategoryDefault: 'out_of_scope',
    });
    expect(pick('6200')).toMatchObject({ name: '地代家賃', type: 'expense', taxCategoryDefault: 'non_taxable' });
    expect(pick('6700')).toMatchObject({ name: '減価償却費', type: 'expense', taxCategoryDefault: 'out_of_scope' });
    expect(pick('6800')).toMatchObject({ name: '租税公課', type: 'expense', taxCategoryDefault: 'out_of_scope' });
    expect(pick('6300')).toMatchObject({ name: '通信費', type: 'expense', taxCategoryDefault: 'standard' });
    expect(pick('6980')).toMatchObject({
      name: '外注費',
      type: 'expense',
      subtype: '販売費及び一般管理費',
      taxCategoryDefault: 'standard',
    });
    // only the receivable/payable accounts require a partner; every spec-listed 不課税/非課税 account is covered above
    expect(all.items.filter((a) => a.partnerRequired).map((a) => a.code)).toEqual(['1300', '2100']);
    const types = new Map<string, number>();
    for (const a of all.items) types.set(a.type, (types.get(a.type) ?? 0) + 1);
    expect(Object.fromEntries(types)).toEqual({ asset: 6, liability: 6, equity: 3, revenue: 2, expense: 14 });
    // codes are the primary key of the seed: the table itself has no duplicates
    expect(new Set(JP_CHART_OF_ACCOUNTS.map((a) => a.code)).size).toBe(JP_CHART_OF_ACCOUNTS.length);
  });

  it('AC-2 seeds the tax rates through the tax module (same 6 codes) and a second company is independent', async () => {
    const codes = (await run((ctx) => repo(ctx, TaxRate).list({ limit: 100 }))).items.map((r) => r.code).sort();
    expect(codes).toEqual(SEED_TAX_RATES.map((r) => r.code).sort());
    const otherCompany = '01999999-0000-7000-8000-000000000002';
    await db.owner
      .sql`insert into companies (id, tenant_id, code, name) values (${otherCompany}, ${db.tenantId}, 'T2', 'Second Co')`;
    const other = (fn: (ctx: Context) => Promise<unknown>) =>
      withContext(db.app, systemParams(db.tenantId, otherCompany), fn);
    expect(await other((ctx) => repo(ctx, Account).count())).toBe(0);
    await other(async (ctx) => JapanModule.seed?.(ctx));
    expect(await other((ctx) => repo(ctx, Account).count())).toBe(JP_CHART_OF_ACCOUNTS.length);
    expect(await other((ctx) => repo(ctx, TaxRate).count())).toBe(SEED_TAX_RATES.length);
    expect(await other(async (ctx) => (await getCompany(ctx)).settings)).toEqual({
      [TAX_ROUNDING_KEY]: { mode: 'down', unit: 'invoice' },
      [TAX_PRICE_INCLUDES_TAX_KEY]: false,
    });
    // the first company is untouched by the second company's seed
    expect(await run((ctx) => repo(ctx, Account).count())).toBe(JP_CHART_OF_ACCOUNTS.length);
  });
});
