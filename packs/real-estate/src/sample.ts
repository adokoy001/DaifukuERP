// Demo data (spec AC-6) = the masters and leases of docs/domain/scenario-real-estate.md (架空「サンプルハイツ」):
// 1 property, 4 units, 4 tenants, 4 draft leases. The script then submits the leases, moves tenants in, bills, collects.
// Tenants pay 当月分を当月末日まで (closing 31, same month, day 31): the arrears list relies on that due date.
// Lease lines carry no product and no tax category, so the unit usage decides it (hooks/contract-defaults.ts).
// Existing codes (property, unit per property, partner) and leases already bound to the same unit and tenant are skipped.
import { repo, saveLines, type Context } from '@daifuku/kernel';
import { Contract, ContractLine } from '@daifuku/mod-contract';
import { Partner } from '@daifuku/mod-partner';
import { RealEstateProperty } from './entities/property.ts';
import { RealEstateUnit } from './entities/unit.ts';
import type { UnitUsage } from './services/tax-rule.ts';

export const SAMPLE_PROPERTY = { code: 'SH', name: 'サンプルハイツ', address: '東京都架空区見本町1-2-3' } as const;

export const SAMPLE_UNITS: readonly {
  code: string;
  name: string;
  usage: UnitUsage;
  floorArea: string | null;
  monthlyRent: string;
}[] = [
  { code: '101', name: '101号室', usage: 'residential', floorArea: '25.5', monthlyRent: '60000' },
  { code: '102', name: '102号室', usage: 'residential', floorArea: '28', monthlyRent: '65000' },
  { code: '201', name: '201号室（事務所）', usage: 'office', floorArea: '42.25', monthlyRent: '100000' },
  { code: 'P1', name: '駐車場 P1', usage: 'parking', floorArea: null, monthlyRent: '8000' },
];

export const SAMPLE_TENANTS: readonly { code: string; name: string; tenantKind: 'individual' | 'corporate' }[] = [
  { code: 'T1', name: '青木 一郎', tenantKind: 'individual' },
  { code: 'T2', name: '井上 花子', tenantKind: 'individual' },
  { code: 'T3', name: '株式会社ウエスト企画', tenantKind: 'corporate' },
  { code: 'T4', name: '江藤 次郎', tenantKind: 'individual' },
];

export const SAMPLE_LEASES: readonly {
  tenant: string;
  unit: string;
  title: string;
  startDate: string;
  keyMoney: string;
  depositMonths: string;
  description: string;
  unitPrice: string;
}[] = [
  {
    tenant: 'T1',
    unit: '101',
    title: 'サンプルハイツ 101 賃貸借契約',
    startDate: '2026-04-01',
    keyMoney: '0',
    depositMonths: '0',
    description: '家賃',
    unitPrice: '60000',
  },
  {
    tenant: 'T2',
    unit: '102',
    title: 'サンプルハイツ 102 賃貸借契約',
    startDate: '2026-11-11',
    keyMoney: '65000',
    depositMonths: '1',
    description: '家賃',
    unitPrice: '65000',
  },
  {
    tenant: 'T3',
    unit: '201',
    title: 'サンプルハイツ 201 賃貸借契約（事務所）',
    startDate: '2026-11-01',
    keyMoney: '100000',
    depositMonths: '2',
    description: '家賃',
    unitPrice: '100000',
  },
  {
    tenant: 'T4',
    unit: 'P1',
    title: 'サンプルハイツ 駐車場 P1 使用契約',
    startDate: '2026-11-01',
    keyMoney: '0',
    depositMonths: '0',
    description: '駐車場代',
    unitPrice: '8000',
  },
];

async function sampleProperty(ctx: Context): Promise<string> {
  const r = repo(ctx, RealEstateProperty);
  const existing = (await r.list({ where: { code: SAMPLE_PROPERTY.code }, limit: 1 })).items[0];
  return existing ? existing.id : (await r.create({ ...SAMPLE_PROPERTY })).id;
}

async function sampleUnits(ctx: Context, propertyId: string): Promise<Map<string, string>> {
  const r = repo(ctx, RealEstateUnit);
  const ids = new Map((await r.list({ where: { propertyId }, limit: 500 })).items.map((u) => [u.code, u.id]));
  for (const u of SAMPLE_UNITS) if (!ids.has(u.code)) ids.set(u.code, (await r.create({ propertyId, ...u })).id);
  return ids;
}

async function sampleTenants(ctx: Context): Promise<Map<string, string>> {
  const r = repo(ctx, Partner);
  const codes = SAMPLE_TENANTS.map((t) => t.code);
  const ids = new Map(
    (await r.list({ where: { code: { $in: codes } }, limit: codes.length })).items.map((p) => [p.code ?? '', p.id]),
  );
  for (const t of SAMPLE_TENANTS) {
    if (ids.has(t.code)) continue;
    const created = await r.create({
      code: t.code,
      name: t.name,
      isCustomer: true,
      closingDay: 31,
      paymentMonthOffset: 0,
      paymentDay: 31,
      ext: { tenantKind: t.tenantKind },
    });
    ids.set(t.code, created.id);
  }
  return ids;
}

async function createLease(
  ctx: Context,
  { partnerId, unitId, lease }: { partnerId: string; unitId: string; lease: (typeof SAMPLE_LEASES)[number] },
): Promise<void> {
  const head = await repo(ctx, Contract).create({
    partnerId,
    title: lease.title,
    startDate: lease.startDate,
    billingDay: 1,
    billingTiming: 'advance',
    ext: { unitId, keyMoney: lease.keyMoney, depositMonths: lease.depositMonths },
  });
  await saveLines(ctx, Contract, head.id, {
    [ContractLine.name]: [{ description: lease.description, unitPrice: lease.unitPrice }],
  });
}

export async function sampleRealEstate(ctx: Context): Promise<void> {
  const units = await sampleUnits(ctx, await sampleProperty(ctx));
  const tenants = await sampleTenants(ctx);
  for (const l of SAMPLE_LEASES) {
    const unitId = units.get(l.unit);
    const partnerId = tenants.get(l.tenant);
    if (unitId === undefined || partnerId === undefined) continue;
    if ((await repo(ctx, Contract).count({ partnerId, 'ext.unitId': unitId })) > 0) continue;
    await createLease(ctx, { partnerId, unitId, lease: l });
  }
}
