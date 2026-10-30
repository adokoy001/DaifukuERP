// The depreciation plan of one fiscal period (docs/specs/fixed-assets.md AC-9, AC-11, AC-13, AC-15, AC-31; D3, D14).
// Reads the calendar, the active assets and the booked history in the caller's Context, then applies the pure year walk
// (schedule.ts) per asset. Preview, run, inbox and the disposal computation share it, so they always agree.
import { Decimal, StateError, repo, type Context, type LocalDate } from '@daifuku/kernel';
import { FixedAsset } from '../entities/fixed-asset.ts';
import {
  memorandumFor,
  selectRate,
  type AssetClass,
  type DepreciationMethod,
  type DepreciationRuleSet,
  type Rate,
} from '../rules.ts';
import {
  activeAssets,
  bookedHistory,
  liveDisposals,
  liveRuns,
  loadPeriods,
  loadYears,
  runLines,
  yearOfDate,
  type AssetRow,
  type BookedHistory,
  type PeriodRow,
  type RunRow,
} from './history.ts';
import {
  monthIndex,
  monthStart,
  periodDue,
  walkYears,
  type FiscalYearLike,
  type WalkAsset,
  type YearState,
} from './schedule.ts';

export const SKIP_REASONS = [
  'disposed',
  'not_in_service',
  'fully_depreciated',
  'already_booked',
  'nothing_due',
  'opening_required',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export const OPENING_REQUIRED_HINT =
  'Enter the opening date and the accumulated depreciation up to it (and, for the declining balance, the revised base) on the asset; it went into service before the first fiscal year of the company.';

/**
 * AC-3: an asset that went into service before the company's first fiscal year and has no opening values (registered
 * or imported while the company had no fiscal year). Its earlier depreciation is unknown, so it is never booked as new.
 */
export function needsOpening(asset: Pick<AssetRow, 'inServiceDate' | 'openingDate'>, years: readonly FiscalYearLike[]) {
  const first = years[0];
  if (!first || asset.openingDate || !asset.inServiceDate) return false;
  return monthStart(monthIndex(asset.inServiceDate)) < first.startDate;
}

/** Kernel line limit of one document (and of one journal entry): a run books at most this many assets (AC-15, D5). */
export const MAX_RUN_ASSETS = 500;

export interface Calendar {
  years: FiscalYearLike[];
  periods: PeriodRow[];
}

export async function loadCalendar(ctx: Context): Promise<Calendar> {
  return { years: await loadYears(ctx), periods: await loadPeriods(ctx) };
}

/** What the arithmetic of one asset needs: its rate row and memorandum value from the rules. */
export interface AssetBasis {
  rate: Rate;
  memorandum: Decimal;
  walk: WalkAsset;
}

const dec = (v: unknown): Decimal => Decimal.from(v === null || v === undefined ? '0' : (v as Decimal));

/** The walk input of an asset, or null when the rules have no rate / memorandum for it (AC-2 (c)). */
export function assetBasis(rules: DepreciationRuleSet, asset: AssetRow): AssetBasis | null {
  const method = asset.method as DepreciationMethod;
  const assetClass = asset.assetClass as AssetClass;
  const rate = selectRate(rules, method, asset.usefulLife, asset.acquisitionDate);
  const memorandum = memorandumFor(rules, assetClass, asset.acquisitionDate);
  if (!rate || !memorandum) return null;
  return {
    rate,
    memorandum,
    walk: {
      cost: dec(asset.cost),
      method,
      rate,
      memorandum,
      inServiceDate: asset.inServiceDate ?? null,
      opening: asset.openingDate
        ? {
            date: asset.openingDate,
            accumulated: dec(asset.openingAccumulatedDepreciation),
            yearDepreciation: dec(asset.openingYearDepreciation),
            revisedBase: asset.openingRevisedBase ? dec(asset.openingRevisedBase) : null,
          }
        : null,
    },
  };
}

/** AC-9: booked per fiscal year = submitted run lines + disposal-year depreciation of submitted disposals. */
export async function loadHistory(
  ctx: Context,
  years: readonly FiscalYearLike[],
  assetIds?: readonly string[],
): Promise<{ runs: RunRow[]; booked: BookedHistory }> {
  const runs = await liveRuns(ctx);
  const booked = await bookedHistory(ctx, runs, assetIds);
  for (const d of await liveDisposals(ctx)) {
    if (assetIds && !assetIds.includes(d.assetId)) continue;
    const amount = d.disposalYearDepreciation ? dec(d.disposalYearDepreciation) : Decimal.zero();
    const year = yearOfDate(years, d.date);
    if (!year || amount.isZero()) continue;
    const perYear = booked.byAsset.get(d.assetId) ?? new Map<string, Decimal>();
    perYear.set(year.id, (perYear.get(year.id) ?? Decimal.zero()).plus(amount));
    booked.byAsset.set(d.assetId, perYear);
  }
  return { runs, booked };
}

export interface PlannedLine {
  asset: AssetRow;
  amount: Decimal;
  /** The year's depreciation (AC-6 / AC-7, after the cap). */
  annualAmount: Decimal;
  openingBookValue: Decimal;
  bookedInYear: Decimal;
  switched: boolean;
  months: number;
  basis: Record<string, unknown>;
}

export interface PeriodPlan {
  period: PeriodRow;
  year: FiscalYearLike;
  lines: PlannedLine[];
  skipped: Record<SkipReason, number>;
  /** Submitted runs of the period, oldest first. */
  runs: RunRow[];
  /** Codes of planned assets that already have a submitted line in a later fiscal year (AC-15). */
  laterYearCodes: string[];
  priorYearPending: { count: number; total: Decimal; periodId: string } | null;
}

export type AssetDue =
  { kind: 'line'; line: PlannedLine } | { kind: 'skip'; reason: Exclude<SkipReason, 'disposed' | 'already_booked'> };

/** AC-9 for one asset and one period of `year` (pure apart from the arguments). */
export function assetDue(
  rules: DepreciationRuleSet,
  asset: AssetRow,
  years: readonly FiscalYearLike[],
  bookedByYear: ReadonlyMap<string, Decimal>,
  year: FiscalYearLike,
  periodStart: LocalDate,
  periodEnd: LocalDate,
): AssetDue {
  const basis = assetBasis(rules, asset);
  if (!basis)
    throw new StateError(
      `the depreciation rules have no rate for asset ${asset.code}`,
      'Check the method, useful life and acquisition date of the asset against fixed_assets.depreciation_rules.',
      { reason: 'rate_missing', code: asset.code },
    );
  if (!asset.inServiceDate || !asset.depreciationStart || asset.depreciationStart > periodEnd)
    return { kind: 'skip', reason: 'not_in_service' };
  if (needsOpening(asset, years)) return { kind: 'skip', reason: 'opening_required' };
  const states = walkYears(basis.walk, years, bookedByYear, year.id);
  const state: YearState | undefined = states[states.length - 1];
  if (!state || state.year.id !== year.id || !state.calc) return { kind: 'skip', reason: 'not_in_service' };
  if (state.openingBookValue.minus(state.booked).minus(basis.memorandum).lte(0))
    return { kind: 'skip', reason: 'fully_depreciated' };
  const due = periodDue(state, monthIndex(periodStart));
  if (due.index <= 0) return { kind: 'skip', reason: 'not_in_service' };
  if (!due.due.gt(0)) return { kind: 'skip', reason: 'nothing_due' };
  return {
    kind: 'line',
    line: {
      asset,
      amount: due.due,
      annualAmount: state.calc.amount,
      openingBookValue: state.openingBookValue,
      bookedInYear: state.booked,
      switched: state.calc.switched,
      months: state.months,
      basis: {
        ruleSetId: rules.id,
        method: asset.method,
        usefulLife: asset.usefulLife,
        rate: basis.rate.rate.toString(),
        revisedRate: basis.rate.revisedRate?.toString() ?? null,
        guaranteeRate: basis.rate.guaranteeRate?.toString() ?? null,
        memorandum: basis.memorandum.toString(),
        openingBookValue: state.openingBookValue.toString(),
        unadjusted: state.calc.unadjusted?.toString() ?? null,
        guarantee: state.calc.guarantee?.toString() ?? null,
        revisedBase: state.calc.revisedBase?.toString() ?? null,
        switched: state.calc.switched,
        months: state.months,
        annualAmount: state.calc.amount.toString(),
        bookedInYear: state.booked.toString(),
        allocatedThrough: due.allocatedThrough.toString(),
      },
    },
  };
}

const emptySkips = (): Record<SkipReason, number> => ({
  disposed: 0,
  not_in_service: 0,
  fully_depreciated: 0,
  already_booked: 0,
  nothing_due: 0,
  opening_required: 0,
});

/** Assets with a submitted line in the period (booked once per asset and period, AC-13). */
async function bookedInPeriod(ctx: Context, runs: readonly RunRow[]): Promise<Set<string>> {
  if (runs.length === 0) return new Set();
  return new Set((await runLines(ctx, runs)).map((l) => l.assetId));
}

/** AC-11 / AC-13 / AC-15: the plan of `period` for every active asset (or only `assets`). */
export async function planForPeriod(
  ctx: Context,
  rules: DepreciationRuleSet,
  calendar: Calendar,
  period: PeriodRow,
  opts: { assets?: AssetRow[]; withPriorYear?: boolean } = {},
): Promise<PeriodPlan> {
  const year = calendar.years.find((y) => y.id === period.fiscalYearId);
  if (!year) throw new StateError(`fiscal year of period ${period.code} not found`, 'Reload the fiscal calendar.');
  const assets = opts.assets ?? (await activeAssets(ctx));
  const { runs, booked } = await loadHistory(ctx, calendar.years);
  const periodRuns = runs.filter((r) => r.periodId === period.id);
  const already = await bookedInPeriod(ctx, periodRuns);
  const skipped = emptySkips();
  skipped.disposed = opts.assets ? 0 : await repo(ctx, FixedAsset).count({ status: 'disposed' });
  const lines: PlannedLine[] = [];
  const laterYearCodes: string[] = [];
  for (const asset of assets) {
    if (asset.status !== 'active') {
      skipped.disposed += 1;
      continue;
    }
    if (already.has(asset.id)) {
      skipped.already_booked += 1;
      continue;
    }
    const due = assetDue(
      rules,
      asset,
      calendar.years,
      booked.byAsset.get(asset.id) ?? new Map(),
      year,
      period.startDate,
      period.endDate,
    );
    if (due.kind === 'skip') {
      skipped[due.reason] += 1;
      continue;
    }
    lines.push(due.line);
    const last = booked.lastDate.get(asset.id);
    if (last && last > year.endDate) laterYearCodes.push(asset.code);
  }
  let priorYearPending: PeriodPlan['priorYearPending'] = null;
  if (opts.withPriorYear !== false) {
    const idx = calendar.years.findIndex((y) => y.id === year.id);
    const prev = idx > 0 ? calendar.years[idx - 1] : undefined;
    const lastPeriod = prev
      ? calendar.periods
          .filter((p) => p.fiscalYearId === prev.id)
          .sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
      : undefined;
    if (prev && !prev.isClosed && lastPeriod) {
      const lastRuns = runs.filter((r) => r.periodId === lastPeriod.id);
      const lastBooked = await bookedInPeriod(ctx, lastRuns);
      let count = 0;
      let total = Decimal.zero();
      for (const asset of assets) {
        if (asset.status !== 'active' || lastBooked.has(asset.id)) continue;
        const due = assetDue(
          rules,
          asset,
          calendar.years,
          booked.byAsset.get(asset.id) ?? new Map(),
          prev,
          lastPeriod.startDate,
          lastPeriod.endDate,
        );
        if (due.kind !== 'line') continue;
        count += 1;
        total = total.plus(due.line.amount);
      }
      if (count > 0) priorYearPending = { count, total, periodId: lastPeriod.id };
    }
  }
  return { period, year, lines, skipped, runs: periodRuns, laterYearCodes, priorYearPending };
}

/** True when the fiscal year is twelve calendar months (the only shape the arithmetic supports, AC-14 / D13). */
export function isTwelveMonthYear(year: FiscalYearLike, periods: readonly PeriodRow[]): boolean {
  const months = monthIndex(year.endDate) - monthIndex(year.startDate) + 1;
  return (
    months === 12 && year.startDate.endsWith('-01') && periods.filter((p) => p.fiscalYearId === year.id).length === 12
  );
}
