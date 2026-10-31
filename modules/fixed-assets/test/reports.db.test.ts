// Postgres tests of the register reports (docs/specs/fixed-assets.md AC-21, AC-22, AC-23; golden PT1). Test DB:
// TEST_DATABASE_URL*. Today is 2027-09-15 (JST); fiscal years run April–March (FY2026, FY2027).
import { checkActionExport, PermissionDenied, registry, type ContextParams } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caught, asRole, setupEnv, type Env, type Row } from './db-setup.ts';
import { TEST_RULES } from './fixture-rules.ts';

const NOW = new Date('2027-09-15T03:00:00Z');
let env: Env;
type Table = { rows: Row[]; totals?: Record<string, string>; meta?: Row };

async function asset(code: string, over: Row = {}): Promise<string> {
  const a = await env.act<{ id: string }>('fixed_asset.create', {
    code,
    name: code,
    assetClass: 'tools_furniture',
    acquisitionDate: '2026-10-01',
    inServiceDate: '2026-10-15',
    cost: '600000',
    method: 'straight_line',
    usefulLife: 5,
    assetAccountId: await env.account('1925'),
    ...over,
  });
  return a.id;
}
async function retire(assetId: string, date: string) {
  const d = await env.act<{ id: string }>('fixed_asset_disposal.create', { assetId, date, kind: 'retirement' });
  await env.act('fixed_asset_disposal.submit', { id: d.id });
}
const fiscalYearId = (code: string) =>
  env.act<{ items: { id: string }[] }>('fiscal_year.list', { where: { code } }).then((r) => r.items[0]?.id as string);

beforeAll(async () => {
  env = await setupEnv(NOW, { fiscalYears: ['2026-04-01', '2027-04-01'] });
  await asset('S1');
  const s2 = await asset('S2');
  await env.act('fixed_assets.run_depreciation', { periodId: await env.periodId('2027-03') });
  await env.act('fixed_assets.run_depreciation', { periodId: await env.periodId('2027-06') });
  await retire(s2, '2027-08-20');
  // PT1 (not in service: no depreciation, no opening values needed).
  const pt = { inServiceDate: null, municipality: '渋谷区' };
  await asset('X', { ...pt, acquisitionDate: '2025-05-01', cost: '500000' });
  await asset('Y', {
    ...pt,
    assetClass: 'machinery',
    acquisitionDate: '2026-06-01',
    cost: '1200000',
    assetAccountId: await env.account('1923'),
  });
  const z = await asset('Z', { ...pt, acquisitionDate: '2024-01-10', cost: '300000' });
  await retire(z, '2026-09-30');
  await asset('W', { ...pt, assetClass: 'vehicle', acquisitionDate: '2024-01-10', cost: '2000000' });
  await asset('V', { ...pt, acquisitionDate: '2027-02-01', cost: '90000' });
});
afterAll(async () => {
  await env.db.close();
});

describe('depreciation schedule (AC-21)', () => {
  it('AC-21: FY2026 — additions, depreciation and closing values per asset, with totals', async () => {
    const t = await env.act<Table>('fixed_assets.depreciation_schedule', {
      fiscalYearId: await fiscalYearId('FY2026'),
    });
    const s1 = t.rows.find((r) => r.code === 'S1');
    expect([
      s1?.openingBookValue,
      s1?.increase,
      s1?.depreciation,
      s1?.decrease,
      s1?.closingBookValue,
      s1?.closingAccumulated,
    ]).toEqual(['0', '600000', '60000', '0', '540000', '60000']);
    const z = t.rows.find((r) => r.code === 'Z');
    expect([z?.openingBookValue, z?.decrease, z?.closingBookValue, z?.status]).toEqual([
      '300000',
      '300000',
      '0',
      '除却・売却済み',
    ]);
    expect([s1?.assetClass, s1?.method, s1?.status]).toEqual(['工具、器具及び備品', '定額法', '使用中']);
    for (const r of t.rows)
      expect(Number(r.openingBookValue) + Number(r.increase) - Number(r.depreciation) - Number(r.decrease)).toBe(
        Number(r.closingBookValue),
      );
    expect(t.totals?.depreciation).toBe('120000');
  });

  it('AC-21: the default year contains today; a disposal shows the disposal-year depreciation and the book value removed', async () => {
    const t = await env.act<Table>('fixed_assets.depreciation_schedule', {});
    expect(t.meta?.fiscalYearCode).toBe('FY2027');
    const s2 = t.rows.find((r) => r.code === 'S2');
    expect([
      s2?.openingBookValue,
      s2?.depreciation,
      s2?.decrease,
      s2?.closingBookValue,
      s2?.closingAccumulated,
    ]).toEqual(['540000', '50000', '490000', '0', '0']);
    expect(t.rows.map((r) => r.code)).not.toContain('Z');
  });

  it('AC-21 AC-34: cell labels follow the viewer language (class, method, status)', async () => {
    const t = await env.act<Table>('fixed_assets.depreciation_schedule', {}, { locale: 'en' });
    const s2 = t.rows.find((r) => r.code === 'S2');
    expect([s2?.assetClass, s2?.method, s2?.status]).toEqual([
      'Tools, furniture and fixtures',
      'Straight-line',
      'Disposed',
    ]);
    expect(t.meta?.truncated).toBeUndefined();
  });
});

describe('property tax aggregate (AC-22)', () => {
  it('AC-22 golden PT1: 渋谷区 × 2 機械及び装置 and × 6 工具、器具及び備品; vehicle and later acquisitions out', async () => {
    const t = await env.act<Table>('fixed_assets.property_tax_summary', { year: 2027 });
    const shibuya = t.rows.filter((r) => r.municipality === '渋谷区');
    expect(
      shibuya.map((r) => [r.propertyTaxClass, r.priorCost, r.priorCount, r.decreaseCost, r.increaseCost, r.totalCost]),
    ).toEqual([
      ['2 機械及び装置', '0', 0, '0', '1200000', '1200000'],
      ['6 工具、器具及び備品', '800000', 2, '300000', '0', '500000'],
    ]);
    expect(t.meta).toMatchObject({ assessmentDate: '2027-01-01', previousAssessmentDate: '2026-01-01' });
  });

  it('AC-22 AC-34: in English the class labels and the unset municipality are English', async () => {
    const t = await env.act<Table>('fixed_assets.property_tax_summary', { year: 2028 }, { locale: 'en' });
    expect(t.rows.map((r) => [r.municipality, r.propertyTaxClass])).toEqual([
      ['渋谷区', '2 Machinery and equipment'],
      ['渋谷区', '6 Tools, furniture and fixtures'],
      ['(not set)', '6 Tools, furniture and fixtures'],
    ]);
  });
});

describe('rules and export (AC-23, AC-21, AC-22, AC-24)', () => {
  it('AC-23: the rules action returns the registered set and the company confirmation', async () => {
    const r = await env.act<Row & { confirmation: Row }>('fixed_assets.depreciation_rules', {});
    expect([r.id, r.verifiedOn, r.confirmation.confirmedOn, r.confirmation.usable]).toEqual([
      TEST_RULES.id,
      null,
      '2026-10-30',
      true,
    ]);
  });

  it('AC-24: accounting may export both reports as CSV; a viewer runs them but the export is PERMISSION_DENIED', async () => {
    const check = (params: Partial<ContextParams>, name: string) =>
      env.run(params, async (ctx) => checkActionExport(ctx, registry.action(name)));
    for (const name of ['fixed_assets.depreciation_schedule', 'fixed_assets.property_tax_summary']) {
      await check(asRole(['accounting']), name);
      expect(await caught(check(asRole(['viewer']), name))).toBeInstanceOf(PermissionDenied);
      await env.act(name, {}, asRole(['viewer']));
    }
  });
});
