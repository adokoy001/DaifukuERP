import {
  column,
  Decimal,
  defineAction,
  DOCSTATUS,
  isLocalDate,
  label,
  MAX_REPORT_ROWS,
  repo,
  StateError,
  tableResult,
  type Context,
  type Domain,
  type EntityDef,
  type Infer,
  type TableResult,
} from '@daifuku/kernel';
import { z } from 'zod';
import { FarmHarvest } from '../entities/harvest.ts';
import { FarmCrop, FarmField } from '../entities/masters.ts';
import { FarmSeason } from '../entities/season.ts';
import { FarmWork } from '../entities/work.ts';
import { invalid } from '../services/validation.ts';

const date = z.string().refine(isLocalDate, 'must be YYYY-MM-DD');
export const seasonSummaryInput = z.object({
  from: date.meta({ title: '集計開始日' }),
  to: date.meta({ title: '集計終了日' }),
  asOf: date.meta({ title: '取消の基準日' }),
});
export type SeasonSummaryInput = z.output<typeof seasonSummaryInput>;
async function all<E extends EntityDef>(ctx: Context, entity: E, where: Domain): Promise<Infer<E>[]> {
  const rows: Infer<E>[] = [];
  for (let offset = 0; ;) {
    const page = await repo(ctx, entity).list({ where, limit: 500, offset, orderBy: [{ field: 'id', dir: 'asc' }] });
    if (page.total > MAX_REPORT_ROWS)
      throw new StateError(
        'Too many source records for the season summary',
        'Narrow the report period. No partial totals were returned.',
      );
    rows.push(...page.items);
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) return rows;
  }
}
export function effective(row: { docstatus: number; cancelledDate: string | null }, asOf: string): boolean {
  if (row.docstatus === DOCSTATUS.cancelled && !row.cancelledDate)
    throw new StateError(
      'Cancelled farm record has no effective date',
      'Restore the cancellation history before reporting.',
    );
  return (
    row.docstatus === DOCSTATUS.submitted || (row.docstatus === DOCSTATUS.cancelled && String(row.cancelledDate) > asOf)
  );
}
interface Totals {
  quantity: Decimal;
  amount: Decimal;
  hours: Decimal;
  harvests: number;
  works: number;
  unit: string;
}
export async function seasonSummary(ctx: Context, input: SeasonSummaryInput): Promise<TableResult> {
  if (input.from > input.to || input.to > input.asOf) invalid('to', 'Use from <= to <= asOf.');
  const where: Domain = {
    docstatus: { $in: [DOCSTATUS.submitted, DOCSTATUS.cancelled] },
    $and: [{ date: { $gte: input.from } }, { date: { $lte: input.to } }],
  };
  const work = await all(ctx, FarmWork, where);
  const harvest = await all(ctx, FarmHarvest, where);
  const groups = new Map<string, Totals>();
  const group = (id: string) => {
    let value = groups.get(id);
    if (!value) {
      value = {
        quantity: Decimal.zero(),
        amount: Decimal.zero(),
        hours: Decimal.zero(),
        harvests: 0,
        works: 0,
        unit: '',
      };
      groups.set(id, value);
    }
    return value;
  };
  for (const row of work)
    if (effective(row, input.asOf)) {
      const g = group(row.seasonId);
      g.hours = g.hours.plus(row.laborHours);
      g.works += 1;
    }
  for (const row of harvest)
    if (effective(row, input.asOf)) {
      if (!row.uomCode || !row.productId)
        throw new StateError(
          'Harvest has no issued product/unit snapshot',
          'Restore the harvest snapshot before reporting.',
        );
      const g = group(row.seasonId);
      if (g.unit && g.unit !== row.uomCode)
        throw new StateError(
          'A season contains mixed stock units',
          'Separate crops and units into different growing seasons.',
        );
      g.unit = row.uomCode;
      g.quantity = g.quantity.plus(row.quantity);
      g.amount = g.amount.plus(row.valuationAmount);
      g.harvests += 1;
    }
  const rows = [];
  for (const [seasonId, g] of groups) {
    const season = await repo(ctx, FarmSeason).get(seasonId);
    const field = await repo(ctx, FarmField).get(season.fieldId);
    const crop = await repo(ctx, FarmCrop).get(season.cropId);
    rows.push({
      seasonId,
      field: field.name,
      season: season.name,
      crop: crop.name,
      unit: g.unit,
      harvestQuantity: g.quantity.toString(),
      harvestValuation: g.amount.toString(),
      laborHours: g.hours.toString(),
      workCount: g.works,
      harvestCount: g.harvests,
    });
  }
  rows.sort((a, b) => a.field.localeCompare(b.field) || a.season.localeCompare(b.season));
  return {
    title: label('圃場・作期集計', 'Field and season summary'),
    columns: [
      column('field', label('圃場', 'Field'), 'text'),
      column('season', label('作期', 'Season'), 'text'),
      column('crop', label('作物', 'Crop'), 'text'),
      column('harvestQuantity', label('収穫数量', 'Harvest quantity'), 'decimal'),
      column('unit', label('在庫単位', 'Stock unit'), 'text'),
      column('harvestValuation', label('収穫評価額（円）', 'Harvest valuation (JPY)'), 'decimal'),
      column('laborHours', label('作業人時', 'Person-hours'), 'decimal'),
      column('workCount', label('作業件数', 'Work records'), 'int'),
      column('harvestCount', label('収穫件数', 'Harvest records'), 'int'),
    ],
    rows,
    totals: {
      harvestValuation: Decimal.sum([...groups.values()].map((g) => g.amount)).toString(),
      laborHours: Decimal.sum([...groups.values()].map((g) => g.hours)).toString(),
    },
    meta: { ...input, valuationCurrency: 'JPY', productionCostAllocation: false },
  };
}
export const seasonSummaryAction = defineAction({
  exportEntities: ['farm_work', 'farm_harvest', 'farm_season', 'farm_field', 'farm_crop'],
  name: 'farm.season_summary',
  description: label(
    '圃場・作期ごとに収穫数量、入力した収穫評価額、作業人時を集計します。生産原価・売上・利益の計算ではありません。',
    'Summarize harvest quantity, entered valuation, and person-hours by field and growing season.',
  ),
  input: seasonSummaryInput,
  output: tableResult,
  permission: { entity: FarmSeason.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: seasonSummary,
});
