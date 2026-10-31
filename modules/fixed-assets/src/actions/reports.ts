// Reports of the register (docs/specs/fixed-assets.md AC-21, AC-22, AC-23; D12): the depreciation schedule of a fiscal
// year, the 償却資産申告 aggregate by municipality × class, and the registered rule set. TableResult, read-only; the CSV
// export authorises against exportEntities (the entities whose values appear in the output).
import {
  column,
  Decimal,
  defineAction,
  label,
  MAX_REPORT_ROWS,
  repo,
  StateError,
  tableResult,
  todayLocal,
  type Context,
  type Label,
  type LocalDate,
} from '@daifuku/kernel';
import { FiscalYear } from '@daifuku/mod-accounting';
import { z } from 'zod';
import { DepreciationRunLine } from '../entities/depreciation-run.ts';
import { FixedAssetDisposal } from '../entities/disposal.ts';
import { ASSET_CLASS_LABELS, ASSET_STATUS_LABELS, FixedAsset, METHOD_LABELS } from '../entities/fixed-asset.ts';
import { depreciationRuleSetSchema, loadRules, rulesConfirmation, type AssetClass } from '../rules.ts';
import { allAssets, liveDisposals, loadYears, yearOfDate } from '../services/history.ts';
import { loadHistory } from '../services/plan.ts';
import { propertyTaxRows, UNSET_MUNICIPALITY_LABEL } from '../services/property-tax.ts';

const ZERO = Decimal.zero();
const dec = (v: unknown): Decimal =>
  v === null || v === undefined || v === '' ? ZERO : Decimal.from(v as Decimal | string);

export const SCHEDULE_COLUMNS = [
  column('code', label('資産番号', 'Asset code'), 'text'),
  column('name', label('名称', 'Name'), 'text'),
  column('assetClass', label('資産の種類', 'Asset class'), 'text'),
  column('acquisitionDate', label('取得日', 'Acquired'), 'date'),
  column('inServiceDate', label('事業供用日', 'In service'), 'date'),
  column('method', label('償却方法', 'Method'), 'text'),
  column('usefulLife', label('耐用年数', 'Useful life'), 'int'),
  column('cost', label('取得価額', 'Cost'), 'decimal'),
  column('openingBookValue', label('期首帳簿価額', 'Opening book value'), 'decimal'),
  column('increase', label('当期増加', 'Additions'), 'decimal'),
  column('depreciation', label('当期償却', 'Depreciation'), 'decimal'),
  column('decrease', label('当期減少', 'Disposals'), 'decimal'),
  column('closingBookValue', label('期末帳簿価額', 'Closing book value'), 'decimal'),
  column('closingAccumulated', label('期末償却累計', 'Closing accumulated depreciation'), 'decimal'),
  column('status', label('状態', 'Status'), 'text'),
  column('assetId', label('資産', 'Asset'), 'ref', { ref: FixedAsset.name }),
];
const SCHEDULE_TOTALS = [
  'cost',
  'openingBookValue',
  'increase',
  'depreciation',
  'decrease',
  'closingBookValue',
  'closingAccumulated',
] as const;

type Locale = Context['locale'];
const classLabel = (c: string, locale: Locale) => ASSET_CLASS_LABELS[c as AssetClass]?.[locale] ?? c;
const methodLabel = (m: string, locale: Locale) => METHOD_LABELS[m as keyof typeof METHOD_LABELS]?.[locale] ?? m;

/**
 * docs/conventions/reports.md: at most MAX_REPORT_ROWS rows; beyond it the first rows are returned with
 * `meta.truncated = true`, the totals still cover every row and the title says so.
 */
function capRows<T>(rows: readonly T[], title: Label): { rows: T[]; title: Label; meta: Record<string, unknown> } {
  if (rows.length <= MAX_REPORT_ROWS) return { rows: [...rows], title, meta: {} };
  const shown = MAX_REPORT_ROWS.toLocaleString('en-US');
  return {
    rows: rows.slice(0, MAX_REPORT_ROWS),
    title: label(
      `${title.ja}（先頭 ${shown} 行を表示。合計は全 ${rows.length.toLocaleString('en-US')} 行）`,
      `${title.en} (first ${shown} rows shown; totals cover all ${rows.length.toLocaleString('en-US')} rows)`,
    ),
    meta: { truncated: true, totalRows: rows.length },
  };
}

/** AC-21: the depreciation schedule of a fiscal year (default: the year containing today, else the last year). */
export async function depreciationSchedule(ctx: Context, input: { fiscalYearId?: string | undefined }) {
  const years = await loadYears(ctx);
  if (years.length === 0)
    throw new StateError('the company has no fiscal year', 'Open a fiscal year with accounting.open_fiscal_year.', {
      reason: 'no_fiscal_period',
    });
  // AC-25: another company's (or an unknown) fiscal year id is NOT_FOUND, like the preview's period id.
  if (input.fiscalYearId) await repo(ctx, FiscalYear).get(input.fiscalYearId);
  const today = todayLocal(ctx.now());
  const year = input.fiscalYearId
    ? years.find((y) => y.id === input.fiscalYearId)
    : (yearOfDate(years, today) ?? years[years.length - 1]);
  if (!year)
    throw new StateError(`fiscal year ${input.fiscalYearId} not found`, 'Pick a fiscal year of the company.', {
      reason: 'no_fiscal_year',
    });
  const assets = (await allAssets(ctx)).filter(
    (a) => a.acquisitionDate <= year.endDate && (!a.disposedOn || a.disposedOn >= year.startDate),
  );
  const { booked } = await loadHistory(ctx, years);
  const disposals = new Map((await liveDisposals(ctx)).map((d) => [d.assetId, d]));
  const before = years.filter((y) => y.endDate < year.startDate).map((y) => y.id);
  const rows = assets.map((a) => {
    const cost = dec(a.cost);
    const byYear = booked.byAsset.get(a.id) ?? new Map<string, Decimal>();
    const openingInYear = !!a.openingDate && a.openingDate >= year.startDate && a.openingDate <= year.endDate;
    const openingBefore = !!a.openingDate && a.openingDate < year.startDate;
    const accumulatedBefore = before
      .reduce((s, id) => s.plus(byYear.get(id) ?? ZERO), ZERO)
      .plus(openingBefore ? dec(a.openingAccumulatedDepreciation) : ZERO)
      .plus(openingInYear ? dec(a.openingAccumulatedDepreciation).minus(dec(a.openingYearDepreciation)) : ZERO);
    const acquiredInYear = a.acquisitionDate >= year.startDate;
    const openingBookValue = acquiredInYear ? ZERO : cost.minus(accumulatedBefore);
    const increase = acquiredInYear ? cost : ZERO;
    const depreciation = (byYear.get(year.id) ?? ZERO).plus(openingInYear ? dec(a.openingYearDepreciation) : ZERO);
    const disposal = disposals.get(a.id);
    const disposedInYear = !!disposal && disposal.date >= year.startDate && disposal.date <= year.endDate;
    const decrease = disposedInYear ? dec(disposal?.bookValue) : ZERO;
    const closingBookValue = openingBookValue.plus(increase).minus(depreciation).minus(decrease);
    const closingAccumulated = disposedInYear ? ZERO : cost.minus(closingBookValue);
    return {
      assetId: a.id,
      code: a.code,
      name: a.name,
      assetClass: classLabel(a.assetClass, ctx.locale),
      acquisitionDate: a.acquisitionDate,
      inServiceDate: a.inServiceDate ?? null,
      method: methodLabel(a.method, ctx.locale),
      usefulLife: a.usefulLife,
      cost,
      openingBookValue,
      increase,
      depreciation,
      decrease,
      closingBookValue,
      closingAccumulated,
      status:
        ASSET_STATUS_LABELS[disposedInYear || (a.disposedOn && a.disposedOn <= year.endDate) ? 'disposed' : 'active'][
          ctx.locale
        ],
    };
  });
  const totals = Object.fromEntries(
    SCHEDULE_TOTALS.map((k) => [k, rows.reduce((s, r) => s.plus(r[k]), ZERO).toString()]),
  ) as Record<string, string>;
  const capped = capRows(rows, label(`減価償却明細表 ${year.code}`, `Depreciation schedule ${year.code}`));
  return {
    title: capped.title,
    columns: SCHEDULE_COLUMNS,
    rows: capped.rows.map((r) => ({
      ...r,
      ...Object.fromEntries(SCHEDULE_TOTALS.map((k) => [k, r[k].toString()])),
    })),
    totals,
    meta: { fiscalYearId: year.id, fiscalYearCode: year.code, from: year.startDate, to: year.endDate, ...capped.meta },
  };
}

export const depreciationScheduleAction = defineAction({
  name: 'fixed_assets.depreciation_schedule',
  description: label(
    '会計年度の減価償却明細表（資産ごとの期首帳簿価額・当期増加・当期償却・当期減少・期末帳簿価額）。fiscalYearId を省略すると今日を含む年度。',
    'Depreciation schedule of a fiscal year: opening book value, additions, depreciation, disposals and closing book value per asset. Defaults to the year containing today.',
  ),
  input: z.object({ fiscalYearId: z.uuid().optional() }),
  output: tableResult,
  permission: { entity: FixedAsset.name, op: 'read' },
  exportEntities: [FixedAsset.name, DepreciationRunLine.name, FixedAssetDisposal.name],
  tx: 'none',
  mutates: false,
  handler: depreciationSchedule,
});

export const PROPERTY_TAX_COLUMNS = [
  column('municipality', label('所在市区町村', 'Municipality'), 'text'),
  column('propertyTaxClass', label('資産の種類', 'Asset type'), 'text'),
  column('priorCost', label('前年前に取得したもの', 'Acquired before last year'), 'decimal'),
  column('priorCount', label('件数（前年前）', 'Count (before last year)'), 'int'),
  column('decreaseCost', label('前年中に減少したもの', 'Decreased last year'), 'decimal'),
  column('decreaseCount', label('件数（減少）', 'Count (decreased)'), 'int'),
  column('increaseCost', label('前年中に取得したもの', 'Acquired last year'), 'decimal'),
  column('increaseCount', label('件数（取得）', 'Count (acquired)'), 'int'),
  column('totalCost', label('計', 'Total'), 'decimal'),
  column('totalCount', label('件数（計）', 'Count (total)'), 'int'),
];

const pad = (n: number) => String(n).padStart(2, '0');

/** AC-22: acquisition costs held on the assessment dates A (`year`) and B (`year` − 1), by municipality × class. */
export async function propertyTaxSummary(ctx: Context, input: { year?: number | undefined }) {
  const rules = await loadRules(ctx);
  const year = input.year ?? Number(todayLocal(ctx.now()).slice(0, 4));
  const { assessmentMonth: m, assessmentDay: d } = rules.propertyTax;
  const current = `${year}-${pad(m)}-${pad(d)}` as LocalDate;
  const previous = `${year - 1}-${pad(m)}-${pad(d)}` as LocalDate;
  const classes = rules.propertyTax.classes;
  const assets = await allAssets(ctx);
  const rows = propertyTaxRows(
    assets.map((a) => ({
      municipality: a.municipality ?? null,
      propertyTaxClass: a.propertyTaxClass ?? 'excluded',
      acquisitionDate: a.acquisitionDate,
      disposedOn: a.disposedOn ?? null,
      cost: dec(a.cost),
    })),
    previous,
    current,
    classes.map((c) => c.code),
  );
  const classText = (code: string) => {
    const c = classes.find((x) => x.code === code);
    return c ? `${c.number} ${c.label[ctx.locale]}` : code;
  };
  const sum = (k: 'priorCost' | 'decreaseCost' | 'increaseCost' | 'totalCost') =>
    rows.reduce((s, r) => s.plus(r[k]), ZERO).toString();
  const capped = capRows(
    rows,
    label(
      `償却資産申告の集計（${year}年度、賦課期日 ${current}）`,
      `Depreciable asset return aggregate ${year} (${current})`,
    ),
  );
  return {
    title: capped.title,
    columns: PROPERTY_TAX_COLUMNS,
    rows: capped.rows.map((r) => ({
      municipality: r.municipality ?? UNSET_MUNICIPALITY_LABEL[ctx.locale],
      propertyTaxClass: classText(r.propertyTaxClass),
      priorCost: r.priorCost.toString(),
      priorCount: r.priorCount,
      decreaseCost: r.decreaseCost.toString(),
      decreaseCount: r.decreaseCount,
      increaseCost: r.increaseCost.toString(),
      increaseCount: r.increaseCount,
      totalCost: r.totalCost.toString(),
      totalCount: r.totalCount,
    })),
    totals: {
      priorCost: sum('priorCost'),
      decreaseCost: sum('decreaseCost'),
      increaseCost: sum('increaseCost'),
      totalCost: sum('totalCost'),
    },
    meta: { year, assessmentDate: current, previousAssessmentDate: previous, ruleSetId: rules.id, ...capped.meta },
  };
}

export const propertyTaxSummaryAction = defineAction({
  name: 'fixed_assets.property_tax_summary',
  description: label(
    '償却資産申告の準備: 賦課期日現在の取得価額を所在市区町村 × 種類で「前年前・前年中減少・前年中取得・計」に集計します（評価額・税額は計算しません）。',
    'Depreciable asset (property tax) return preparation: acquisition costs on the assessment date by municipality and class (before last year, decreased, acquired, total). No valuation or tax.',
  ),
  input: z.object({ year: z.number().int().min(2000).max(2200).optional() }),
  output: tableResult,
  permission: { entity: FixedAsset.name, op: 'read' },
  exportEntities: [FixedAsset.name],
  tx: 'none',
  mutates: false,
  handler: propertyTaxSummary,
});

export const rulesOutput = depreciationRuleSetSchema.extend({
  confirmation: z.object({ confirmedOn: z.string().nullable(), usable: z.boolean() }),
});

/** AC-23: the registered rule set and the company's confirmation record (read-only). */
export async function depreciationRules(ctx: Context) {
  const rules = await loadRules(ctx);
  const confirmation = await rulesConfirmation(ctx, rules);
  return { ...rules, confirmation };
}

export const depreciationRulesAction = defineAction({
  name: 'fixed_assets.depreciation_rules',
  description: label(
    '登録された国別の償却規則（償却率表・備忘価額・償却方法の制限・耐用年数の例・償却資産申告のデータ・出典）と、会社の照合記録を返します。',
    'The registered country depreciation rules (rate tables, memorandum values, method restrictions, useful-life examples, property-tax data, sources) and the company confirmation.',
  ),
  input: z.object({}).strict(),
  output: rulesOutput,
  permission: { entity: FixedAsset.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: (ctx) => depreciationRules(ctx),
});
