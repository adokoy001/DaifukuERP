// Steps of scenario-real-estate.db.test.ts that are long enough to live apart: pack:apply (step 0), ext / tax-category
// defaults / meta (step 1) and the post-script (step 12: 退去・敷金返還・ガード). Expected figures: docs/domain/scenario-real-estate.md.
import { appMeta, getCompany, newId, PACKS_APPLIED_KEY, readAppliedPacks } from '@daifuku/kernel';
import { expect } from 'vitest';
import { caught, type DocJson, type ListJson, type Row, type scenario, type Table } from './support.ts';

type S = ReturnType<typeof scenario>;
export interface ScriptState {
  acc: Record<string, string>;
  unit: Record<string, string>;
  tenant: Record<string, string>;
  lease: Record<string, string>;
  inv: Record<string, string>;
  deposit: Record<string, string>;
}
type LeaseJson = DocJson & { title: string; startDate: string; ext: Row; partnerId: string; lines: { contract_line: Row[] } };

const D = '2026-11-01';

async function companySettings(s: S): Promise<Record<string, unknown>> {
  return (await s.run(D, getCompany)).settings;
}

export async function checkApply(s: S, st: ScriptState): Promise<void> {
  // This new-company scenario deliberately chooses the real-estate pack's tax-exclusive settings.
  // Normal apply preserves stored company choices, even when they equal an old module default.
  const res = await s.act<Row>(D, 'pack.apply', { name: 'real_estate', sample: true, force: true });
  expect(res).toMatchObject({
    name: 'real_estate',
    version: '0.1.0',
    alreadyApplied: false,
    seeded: true,
    sampled: true,
    // Explicit initial adoption of the scenario's company settings; financial expectations stay unchanged.
    settings: { written: ['sales.accounts', 'contract.default_proration', 'contract.auto_submit', 'tax.price_includes_tax', 'real_estate.accounts'], kept: [] },
  });
  const settings = await companySettings(s);
  expect(settings).toMatchObject({
    'sales.accounts': { receivable: '1300', revenue: '4200', taxPayable: '2200' },
    'contract.default_proration': 'daily',
    'contract.auto_submit': false,
    'tax.price_includes_tax': false,
    'real_estate.accounts': { deposit: '2500', rentRevenue: '4200', bank: '1100', deduction: '4100' },
  });
  st.acc = await s.loadAccounts(D);
  for (const code of ['1100', '1300', '2200', '2500', '3000', '4100', '4200', '4210']) expect(st.acc[code], `account ${code}`).toBeDefined();
  const accounts = await s.act<ListJson>(D, 'account.list', { where: { code: { $in: ['4200', '4210'] } }, orderBy: [{ field: 'code', dir: 'asc' }] });
  expect(accounts.items.map((a) => [a.code, a.name, a.type])).toEqual([
    ['4200', '賃貸料収入', 'revenue'],
    ['4210', '礼金・更新料収入', 'revenue'],
  ]);
  const products = await s.act<ListJson>(D, 'product.list', { where: { code: { $in: ['RENT', 'RENT_TAXABLE', 'KEY_MONEY'] } }, orderBy: [{ field: 'code', dir: 'asc' }] });
  expect(products.items.map((p) => [p.code, p.name, p.kind, p.taxCategory])).toEqual([
    ['KEY_MONEY', '礼金', 'service', 'non_taxable'],
    ['RENT', '家賃', 'service', 'non_taxable'],
    ['RENT_TAXABLE', '家賃（課税）', 'service', 'standard'],
  ]);
  await checkSample(s, st);

  // second apply: nothing written (unit / lease versions, company settings unchanged)
  const units = await s.act<ListJson>(D, 'real_estate_unit.list', { orderBy: [{ field: 'code', dir: 'asc' }] });
  const again = await s.act<Row>(D, 'pack.apply', { name: 'real_estate', sample: true });
  expect(again).toMatchObject({ alreadyApplied: true, seeded: false, sampled: false, settings: { written: [] } });
  expect((await s.act<ListJson>(D, 'real_estate_unit.list', { orderBy: [{ field: 'code', dir: 'asc' }] })).items.map((u) => u.version)).toEqual(units.items.map((u) => u.version));
  expect(await companySettings(s)).toEqual(settings);
  expect(Object.keys(settings[PACKS_APPLIED_KEY] as Row)).toEqual(['real_estate']);
}

async function checkSample(s: S, st: ScriptState): Promise<void> {
  const properties = await s.act<ListJson>(D, 'real_estate_property.list', {});
  expect(properties.items.map((p) => [p.code, p.name])).toEqual([['SH', 'サンプルハイツ']]);
  const units = await s.act<ListJson>(D, 'real_estate_unit.list', { orderBy: [{ field: 'code', dir: 'asc' }] });
  expect(units.items.map((u) => [u.code, u.usage, u.floorArea, u.monthlyRent, u.status, u.propertyId])).toEqual([
    ['101', 'residential', '25.5', '60000', 'vacant', properties.items[0]?.id],
    ['102', 'residential', '28', '65000', 'vacant', properties.items[0]?.id],
    ['201', 'office', '42.25', '100000', 'vacant', properties.items[0]?.id],
    ['P1', 'parking', null, '8000', 'vacant', properties.items[0]?.id],
  ]);
  st.unit = Object.fromEntries(units.items.map((u) => [String(u.code), String(u.id)]));
  const tenants = await s.act<ListJson>(D, 'partner.list', { where: { code: { $in: ['T1', 'T2', 'T3', 'T4'] } }, orderBy: [{ field: 'code', dir: 'asc' }] });
  expect(tenants.items.map((p) => [p.code, p.name, p.ext, p.closingDay, p.paymentMonthOffset, p.paymentDay])).toEqual([
    ['T1', '青木 一郎', { tenantKind: 'individual' }, 31, 0, 31],
    ['T2', '井上 花子', { tenantKind: 'individual' }, 31, 0, 31],
    ['T3', '株式会社ウエスト企画', { tenantKind: 'corporate' }, 31, 0, 31],
    ['T4', '江藤 次郎', { tenantKind: 'individual' }, 31, 0, 31],
  ]);
  st.tenant = Object.fromEntries(tenants.items.map((p) => [String(p.code), String(p.id)]));
  const byTenant = Object.fromEntries(Object.entries(st.tenant).map(([code, id]) => [id, code]));
  const leases = await s.act<ListJson>(D, 'contract.list', { where: { 'ext.unitId': { $in: Object.values(st.unit) } }, orderBy: [{ field: 'startDate', dir: 'asc' }] });
  const full = await Promise.all(leases.items.map((l) => s.act<LeaseJson>(D, 'contract.get', { id: l.id })));
  const shape = full.map((l) => [byTenant[l.partnerId], l.startDate, l.docstatus, l.billingDay, l.billingTiming, l.ext, l.lines.contract_line.map((x) => [x.description, x.unitPrice, x.taxCategory])]);
  expect(shape.sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
    ['T1', '2026-04-01', 0, 1, 'advance', { unitId: st.unit['101'], keyMoney: '0', depositMonths: '0', renewalFee: '0' }, [['家賃', '60000', 'non_taxable']]],
    ['T2', '2026-11-11', 0, 1, 'advance', { unitId: st.unit['102'], keyMoney: '65000', depositMonths: '1', renewalFee: '0' }, [['家賃', '65000', 'non_taxable']]],
    ['T3', '2026-11-01', 0, 1, 'advance', { unitId: st.unit['201'], keyMoney: '100000', depositMonths: '2', renewalFee: '0' }, [['家賃', '100000', 'standard']]],
    ['T4', '2026-11-01', 0, 1, 'advance', { unitId: st.unit.P1, keyMoney: '0', depositMonths: '0', renewalFee: '0' }, [['駐車場代', '8000', 'standard']]],
  ]);
  st.lease = Object.fromEntries(full.map((l) => [String(byTenant[l.partnerId]), l.id]));
}

export async function checkExtAndDefaults(s: S, st: ScriptState): Promise<void> {
  const badKind = await caught(s.act(D, 'partner.create', { name: '不正な区分', ext: { tenantKind: 'alien' } }));
  expect(badKind).toMatchObject({ code: 'VALIDATION', details: { issues: [expect.objectContaining({ path: 'ext.tenantKind' })] } });
  const noUnit = await caught(s.act(D, 'contract.create', { partnerId: st.tenant.T1, title: 'x', startDate: '2026-12-01', ext: { unitId: newId() }, lines: { contract_line: [{ description: 'x', unitPrice: '1' }] } }));
  expect(noUnit).toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'ext.unitId', message: 'unit not found' }] } });
  expect((await s.act<ListJson>(D, 'contract.list', { where: { 'ext.unitId': st.unit['201'] } })).items.map((c) => c.partnerId)).toEqual([st.tenant.T3]);
  expect((await s.act<ListJson>(D, 'partner.list', { where: { 'ext.tenantKind': 'corporate' } })).items.map((p) => p.code)).toEqual(['T3']);

  // precedence of the line tax category on a residential unit: caller > product > unit usage; < 1 month residential → standard
  const rentTaxable = (await s.act<ListJson>(D, 'product.list', { where: { code: 'RENT_TAXABLE' } })).items[0]?.id;
  const draft = await s.act<LeaseJson>(D, 'contract.create', {
    partnerId: st.tenant.T1,
    title: '税区分の既定の確認',
    startDate: '2026-12-01',
    ext: { unitId: st.unit['101'] },
    lines: { contract_line: [{ description: '家賃', unitPrice: '1000' }, { description: '明示', unitPrice: '1000', taxCategory: 'standard' }, { productId: rentTaxable, unitPrice: '1000' }] },
  });
  expect(draft.lines.contract_line.map((l) => [l.description, l.taxCategory])).toEqual([
    ['家賃', 'non_taxable'],
    ['明示', 'standard'],
    ['家賃（課税）', 'standard'],
  ]);
  expect(draft.ext).toEqual({ unitId: st.unit['101'], keyMoney: '0', depositMonths: '0', renewalFee: '0' });
  const monthly = await s.act<LeaseJson>(D, 'contract.create', { partnerId: st.tenant.T1, title: '短期', startDate: '2026-12-01', endDate: '2026-12-20', ext: { unitId: st.unit['101'] }, lines: { contract_line: [{ description: '短期滞在', unitPrice: '1000' }] } });
  expect(monthly.lines.contract_line.map((l) => l.taxCategory)).toEqual(['standard']);
  const plain = await s.act<LeaseJson>(D, 'contract.create', { partnerId: st.tenant.T1, title: '保守契約（部屋なし）', startDate: '2026-12-01', lines: { contract_line: [{ description: '保守', unitPrice: '1000', taxCategory: 'standard' }] } });
  expect(plain.ext ?? {}).toEqual({});
  for (const c of [draft, monthly, plain]) await s.act(D, 'contract.delete', { id: c.id });

  const meta = await s.run(D, async (ctx) => appMeta(ctx, { appliedPacks: Object.keys(await readAppliedPacks(ctx)) }));
  const entityLabel = (name: string) => meta.entities.find((e) => e.name === name)?.label;
  expect([entityLabel('contract'), entityLabel('sales_invoice'), entityLabel('partner')]).toEqual([
    { ja: '賃貸借契約', en: 'Lease' },
    { ja: '家賃請求書', en: 'Rent invoice' },
    { ja: '入居者/取引先', en: 'Tenant/Partner' },
  ]);
  const ext = (name: string) => meta.entities.find((e) => e.name === name)?.extFields.map((x) => [x.name, x.source]);
  expect(ext('contract')).toEqual(['unitId', 'keyMoney', 'depositMonths', 'renewalFee'].map((k) => [`ext.${k}`, 'pack:real_estate']));
  expect(ext('partner')).toEqual(['tenantKind', 'emergencyContact'].map((k) => [`ext.${k}`, 'pack:real_estate']));
  expect(meta.packs).toContainEqual({ name: 'real_estate', label: { ja: '賃貸管理（不動産）', en: 'Rental management (real estate)' }, applied: true });
  expect(meta.modules.find((m) => m.name === 'real_estate')?.menus.map((m) => m.label.ja)).toEqual(['物件', '部屋・区画', '賃貸借契約', '敷金台帳', 'レントロール', '滞納一覧']);
  const viewer = { roles: ['viewer'], actor: { type: 'user' as const, id: newId() } };
  expect(await caught(s.act(D, 'real_estate.move_in', { contractId: st.lease.T1 }, viewer))).toMatchObject({ code: 'PERMISSION_DENIED' });
  expect((await s.act<Table>(D, 'real_estate.rent_roll', { asOf: D }, viewer)).rows).toHaveLength(4);
}

export async function checkAfterScript(s: S, st: ScriptState): Promise<void> {
  const T2 = st.lease.T2 ?? '';
  expect(await s.act('2026-12-25', 'real_estate.move_out', { contractId: T2, endDate: '2026-12-31' })).toEqual({ contractId: T2, endDate: '2026-12-31', contractStatus: 'active', unitId: st.unit['102'], unitStatus: 'occupied' });
  const rr = await s.act<Table>('2026-12-25', 'real_estate.rent_roll', { asOf: '2027-01-01' });
  expect(rr.rows.map((r) => [r.unitCode, r.status, r.tenantName, r.monthlyRent])).toEqual([
    ['101', 'occupied', '青木 一郎', '60000'],
    ['102', 'vacant', null, '65000'],
    ['201', 'occupied', '株式会社ウエスト企画', '100000'],
    ['P1', 'occupied', '江藤 次郎', '8000'],
  ]);
  expect(rr.totals).toEqual({ monthlyRent: '168000', taxableRent: '108000', nonTaxableRent: '60000' });

  const ret = await s.act<DocJson & Row & { returnJournalEntryId: string }>('2026-12-31', 'real_estate.return_deposit', { depositId: st.deposit.T2, date: '2026-12-31', amount: '65000', deductionAmount: '22000' });
  expect(ret).toMatchObject({ amount: '65000', receivedDate: '2026-11-10', returnedDate: '2026-12-31', returnedAmount: '43000', deductionAmount: '22000' });
  expect(await s.entryLines(ret.returnJournalEntryId)).toEqual([
    ['2500', '65000', '0'],
    ['1100', '0', '43000'],
    ['4100', '0', '22000'],
  ]);
  const tb = await s.act<Table>('2026-12-31', 'accounting.trial_balance', { from: '2026-11-01', to: '2026-12-31' });
  const closing = (code: string) => tb.rows.find((r) => r.code === code)?.closingBalance;
  expect([closing('2500'), closing('4100'), closing('1100')]).toEqual(['-200000', '-22000', '1110333']);

  expect(await s.act('2027-01-04', 'real_estate.move_out', { contractId: T2, endDate: '2026-12-31' })).toMatchObject({ contractStatus: 'ended', unitStatus: 'vacant' });
  expect(await s.act('2027-01-04', 'real_estate_unit.get', { id: st.unit['102'] })).toMatchObject({ status: 'vacant' });

  // guards
  const code = async (p: Promise<unknown>) => ((await caught(p)) as { code?: string } | null)?.code;
  expect(await code(s.act('2026-12-31', 'real_estate.return_deposit', { depositId: st.deposit.T2, date: '2026-12-31', amount: '65000' }))).toBe('INVALID_STATE');
  expect(await code(s.act('2026-12-31', 'real_estate.receive_deposit', { depositId: st.deposit.T3, date: '2026-12-31' }))).toBe('INVALID_STATE');
  expect(await code(s.act('2026-12-31', 'real_estate.move_in', { contractId: st.lease.T3 }))).toBe('INVALID_STATE');
  expect(await caught(s.act('2026-12-31', 'real_estate.return_deposit', { depositId: st.deposit.T3, date: '2026-12-31', amount: '100000' }))).toMatchObject({ code: 'VALIDATION', details: { issues: [expect.objectContaining({ path: 'amount' })] } });
  expect(await code(s.act('2026-12-31', 'real_estate_deposit.update', { id: st.deposit.T3, patch: { receivedDate: '2026-12-01' } }))).toBe('PERMISSION_DENIED');
  expect(await code(s.act('2026-12-31', 'real_estate_deposit.update', { id: st.deposit.T3, patch: { amount: '1' } }))).toBe('INVALID_STATE');
  expect(await code(s.act('2026-12-31', 'real_estate_deposit.delete', { id: st.deposit.T3 }))).toBe('INVALID_STATE');
  expect(await code(s.act('2026-12-31', 'real_estate_unit.delete', { id: st.unit['101'] }))).toBe('INVALID_STATE');
  expect(await s.act('2026-12-31', 'real_estate_unit.update', { id: st.unit['101'], patch: { status: 'vacant', note: '改ざんの確認' } })).toMatchObject({ status: 'occupied', note: '改ざんの確認' });
}
