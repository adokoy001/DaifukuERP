// real_estate.rent_roll (spec AC-4): レントロール as of a date — one row per unit with property, unit, usage, floor area,
// monthly rent (the lease's monthly lines for an occupied unit, the asking rent for a vacant one), tenant, lease start/end,
// status and tax category; totals of the occupied rent split 課税 / 非課税 by the lease lines' tax categories.
// Read-only (tx none); every read goes through the repository in the caller's context.
import {
  defineAction,
  label,
  MAX_REPORT_ROWS,
  column,
  repo,
  tableResult,
  todayLocal,
  type Context,
  type LocalDate,
  type TableResult,
} from '@daifuku/kernel';
import { ContractLine } from '@daifuku/mod-contract';
import { Partner } from '@daifuku/mod-partner';
import { z } from 'zod';
import { RealEstateUnit } from '../entities/unit.ts';
import { allPages, inChunks, leasesOfUnits, partnerNames, propertiesById, unitIdOf } from '../load.ts';
import { rentRoll, type RentRollLease, type RentRollUnit } from '../services/rent-roll.ts';
import { localDate } from './receive-deposit.ts';

export const RENT_ROLL_COLUMNS = [
  column('propertyName', label('物件', 'Property'), 'text'),
  column('unitCode', label('部屋', 'Unit'), 'text'),
  column('usage', label('用途', 'Usage'), 'text'),
  column('floorArea', label('面積（㎡）', 'Floor area (m²)'), 'decimal'),
  column('monthlyRent', label('月額賃料（税抜）', 'Monthly rent (excl. tax)'), 'decimal'),
  column('tenantName', label('入居者', 'Tenant'), 'text'),
  column('startDate', label('契約開始', 'Lease start'), 'date'),
  column('endDate', label('契約終了', 'Lease end'), 'date'),
  column('status', label('状態', 'Status'), 'text'),
  column('taxCategory', label('税区分', 'Tax category'), 'text'),
  column('unitId', label('部屋ID', 'Unit id'), 'ref', { ref: RealEstateUnit.name }),
  column('contractId', label('契約', 'Lease'), 'ref', { ref: 'contract' }),
  column('partnerId', label('入居者ID', 'Tenant id'), 'ref', { ref: Partner.name }),
];

async function loadUnits(ctx: Context): Promise<RentRollUnit[]> {
  const r = repo(ctx, RealEstateUnit);
  const units = await allPages((offset) => r.list({ orderBy: [{ field: 'code', dir: 'asc' }], limit: 500, offset }));
  const properties = await propertiesById(
    ctx,
    units.map((u) => u.propertyId),
  );
  return units.map((u) => ({
    id: u.id,
    propertyCode: properties.get(u.propertyId)?.code ?? '',
    propertyName: properties.get(u.propertyId)?.name ?? u.propertyId,
    code: u.code,
    name: u.name,
    usage: u.usage,
    floorArea: u.floorArea,
    monthlyRent: u.monthlyRent,
  }));
}

async function loadLeases(ctx: Context, unitIds: readonly string[]): Promise<RentRollLease[]> {
  const contracts = await leasesOfUnits(ctx, unitIds);
  const ids = contracts.map((c) => c.id);
  const lr = repo(ctx, ContractLine);
  const lines = await inChunks(ids, (chunk) =>
    allPages((offset) => lr.list({ where: { contractId: { $in: chunk } }, limit: 500, offset })),
  );
  const names = await partnerNames(
    ctx,
    contracts.map((c) => c.partnerId),
  );
  return contracts.flatMap((c) => {
    const unitId = unitIdOf(c);
    if (unitId === null) return [];
    const own = lines
      .filter((l) => l.contractId === c.id)
      .map((l) => ({ amount: l.amount, taxCategory: l.taxCategory }));
    return [
      {
        contractId: c.id,
        unitId,
        partnerId: c.partnerId,
        partnerName: names.get(c.partnerId) ?? c.partnerId,
        startDate: c.startDate,
        endDate: c.endDate,
        lines: own,
      },
    ];
  });
}

export async function rentRollReport(ctx: Context, asOf: LocalDate): Promise<TableResult> {
  const units = await loadUnits(ctx);
  const leases = await loadLeases(
    ctx,
    units.map((u) => u.id),
  );
  const { rows, totals, counts } = rentRoll(units, leases, asOf);
  return {
    title: label(`レントロール ${asOf} 現在`, `Rent roll as of ${asOf}`),
    columns: RENT_ROLL_COLUMNS,
    rows: rows.slice(0, MAX_REPORT_ROWS),
    totals: { ...totals },
    meta: { asOf, counts, truncated: rows.length > MAX_REPORT_ROWS },
  };
}

export const rentRollAction = defineAction({
  name: 'real_estate.rent_roll',
  description: label(
    'レントロール: asOf（省略時は今日）時点の部屋ごとの物件・部屋・用途・面積・月額賃料（入居中は契約明細の月額、空室は募集賃料）・入居者・契約開始/終了・状態・税区分。totals は入居中の月額賃料の合計（課税/非課税別）。',
    'Rent roll as of asOf (default today): per unit the property, unit, usage, floor area, monthly rent (lease lines when occupied, asking rent when vacant), tenant, lease start/end, status and tax category; totals of occupied rent split taxable / non-taxable.',
  ),
  input: z.object({ asOf: localDate.optional() }),
  output: tableResult,
  exportEntities: ['real_estate_unit', 'real_estate_property', 'contract', 'contract_line', 'partner'],
  permission: { entity: RealEstateUnit.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: (ctx, { asOf }) => rentRollReport(ctx, asOf ?? todayLocal(ctx.now())),
});
