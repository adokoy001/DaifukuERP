// Depreciation arithmetic (docs/specs/fixed-assets.md AC-6..AC-9, AC-18; D3, D4, D22). Pure: rates and the memorandum
// value are arguments (the country pack owns the values), amounts are Decimal, yen are cut down (切捨て). The fiscal
// year is the unit of the statutory limit; monthly runs book "allocation through the period − booked this year".
import { Decimal, type LocalDate } from '@daifuku/kernel';
import type { DepreciationMethod, Rate } from '../rules.ts';

export interface FiscalYearLike {
  id: string;
  code: string;
  startDate: LocalDate;
  endDate: LocalDate;
  isClosed: boolean;
}

const ZERO = Decimal.zero();
const TWELVE = Decimal.from(12);

/** Month number (year × 12 + month − 1) of a YYYY-MM-DD date. */
export function monthIndex(date: LocalDate): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

/** First day of the month of a month number. */
export function monthStart(index: number): LocalDate {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
}

const max = (a: Decimal, b: Decimal): Decimal => (a.gte(b) ? a : b);
const min = (a: Decimal, b: Decimal): Decimal => (a.lte(b) ? a : b);

export interface YearAmountInput {
  cost: Decimal;
  method: DepreciationMethod;
  rate: Rate;
  memorandum: Decimal;
  openingBookValue: Decimal;
  /** 改定取得価額 carried from an earlier year (declining balance), or null. */
  revisedBase: Decimal | null;
  /** Months in service in the year (1..12). */
  months: number;
}

export interface YearAmount {
  /** 調整前償却額 (declining balance, unrounded), null for straight line. */
  unadjusted: Decimal | null;
  /** 償却保証額 (declining balance, unrounded), null when the table has no guarantee rate. */
  guarantee: Decimal | null;
  /** The amount for 12 months after the switch decision, unrounded (AC-18 uses it for the disposal limit). */
  full: Decimal;
  /** The year's amount: full × months ÷ 12 cut to yen, capped at opening book value − memorandum value. */
  amount: Decimal;
  revisedBase: Decimal | null;
  /** True when the year uses 改定取得価額 × 改定償却率. */
  switched: boolean;
}

/** AC-6 / AC-7 / AC-8: one fiscal year's amount. */
export function yearAmount(input: YearAmountInput): YearAmount {
  const { cost, method, rate, memorandum, openingBookValue, months } = input;
  let full: Decimal;
  let unadjusted: Decimal | null = null;
  let guarantee: Decimal | null = null;
  let revisedBase = input.revisedBase;
  if (method === 'straight_line') {
    full = cost.times(rate.rate);
  } else if (revisedBase !== null && rate.revisedRate !== null) {
    full = revisedBase.times(rate.revisedRate);
  } else {
    unadjusted = openingBookValue.times(rate.rate);
    guarantee = rate.guaranteeRate === null ? null : cost.times(rate.guaranteeRate);
    // AC-7: switch in the first year whose unadjusted amount is strictly below the guarantee amount (equal: no switch).
    if (guarantee !== null && rate.revisedRate !== null && unadjusted.lt(guarantee)) {
      revisedBase = openingBookValue;
      full = openingBookValue.times(rate.revisedRate);
    } else full = unadjusted;
  }
  const cap = max(ZERO, openingBookValue.minus(memorandum));
  const prorated = full.times(months).div(TWELVE).roundDown(0);
  return {
    unadjusted,
    guarantee,
    full,
    amount: max(ZERO, min(prorated, cap)),
    revisedBase,
    switched: revisedBase !== null && method === 'declining_200',
  };
}

/** AC-9: the year's amount spread over its service months (cut to yen; the remainder goes to the last month). */
export function allocate(amount: Decimal, months: number): Decimal[] {
  if (months <= 0) return [];
  const monthly = amount.div(months).roundDown(0);
  const out = Array.from({ length: months }, () => monthly);
  out[months - 1] = amount.minus(monthly.times(months - 1));
  return out;
}

/** Sum of the allocation of the first `k` service months (k clamped to 0..months). */
export function allocatedThrough(amount: Decimal, months: number, k: number): Decimal {
  if (k <= 0 || months <= 0) return ZERO;
  if (k >= months) return amount;
  return amount.div(months).roundDown(0).times(k);
}

export interface OpeningValues {
  /** First day of a fiscal period: the system books from here. */
  date: LocalDate;
  /** 償却累計 up to the day before `date`. */
  accumulated: Decimal;
  /** The part of `accumulated` booked in the fiscal year that contains `date`. */
  yearDepreciation: Decimal;
  /** 改定取得価額 when the asset had already switched (declining balance). */
  revisedBase: Decimal | null;
}

export interface WalkAsset {
  cost: Decimal;
  method: DepreciationMethod;
  rate: Rate;
  memorandum: Decimal;
  inServiceDate: LocalDate | null;
  opening: OpeningValues | null;
}

export interface YearState {
  year: FiscalYearLike;
  /** Service months in the year (0 when the asset is not yet in service). */
  months: number;
  /** Month number of the first service month in the year. */
  firstServiceMonth: number;
  openingBookValue: Decimal;
  /** Booked in the year: posted run lines, disposal-year depreciation and the opening-year depreciation. */
  booked: Decimal;
  calc: YearAmount | null;
}

const containsDate = (y: FiscalYearLike, d: LocalDate): boolean => y.startDate <= d && d <= y.endDate;

/**
 * AC-9: every fiscal year from the asset's first year (service year, or the opening year) through `targetYearId`, with
 * the opening book value taken from the actual bookings (`bookedByYear`, by fiscal year id). `years` is sorted by start
 * date. Returns [] when the target year is before the first year. A service month before the company's first fiscal
 * year (no opening values) starts at the first year with the full cost: callers must not book such an asset (AC-3 refuses
 * it at registration when the company has a fiscal year; plan.ts `needsOpening` skips it in runs and disposals).
 */
export function walkYears(
  asset: WalkAsset,
  years: readonly FiscalYearLike[],
  bookedByYear: ReadonlyMap<string, Decimal>,
  targetYearId: string,
): YearState[] {
  const targetIdx = years.findIndex((y) => y.id === targetYearId);
  if (targetIdx < 0) return [];
  const startDate = asset.opening?.date ?? asset.inServiceDate;
  if (startDate === null) {
    const y = years[targetIdx] as FiscalYearLike;
    return [
      {
        year: y,
        months: 0,
        firstServiceMonth: monthIndex(y.endDate) + 1,
        openingBookValue: asset.cost,
        booked: bookedByYear.get(y.id) ?? ZERO,
        calc: null,
      },
    ];
  }
  let startIdx = years.findIndex((y) => containsDate(y, startDate));
  if (startIdx < 0) {
    const first = years[0];
    if (!first || startDate > (years[years.length - 1] as FiscalYearLike).endDate) return [];
    if (startDate < first.startDate) startIdx = 0;
    else startIdx = years.findIndex((y) => y.startDate > startDate);
  }
  if (startIdx < 0 || targetIdx < startIdx) return [];
  const openingYear = asset.opening ? years.find((y) => containsDate(y, (asset.opening as OpeningValues).date)) : null;
  let bookValue = asset.opening
    ? asset.cost.minus(asset.opening.accumulated).plus(asset.opening.yearDepreciation)
    : asset.cost;
  let revisedBase = asset.opening?.revisedBase ?? null;
  const serviceMonth = asset.inServiceDate === null ? null : monthIndex(asset.inServiceDate);
  const out: YearState[] = [];
  for (let i = startIdx; i <= targetIdx; i++) {
    const year = years[i] as FiscalYearLike;
    const yStart = monthIndex(year.startDate);
    const yEnd = monthIndex(year.endDate);
    const first = serviceMonth === null ? yEnd + 1 : Math.max(serviceMonth, yStart);
    const months = first > yEnd ? 0 : yEnd - first + 1;
    let booked = bookedByYear.get(year.id) ?? ZERO;
    if (asset.opening && openingYear && openingYear.id === year.id)
      booked = booked.plus(asset.opening.yearDepreciation);
    const calc =
      months > 0
        ? yearAmount({
            cost: asset.cost,
            method: asset.method,
            rate: asset.rate,
            memorandum: asset.memorandum,
            openingBookValue: bookValue,
            revisedBase,
            months,
          })
        : null;
    if (calc) revisedBase = calc.revisedBase;
    out.push({ year, months, firstServiceMonth: first, openingBookValue: bookValue, booked, calc });
    bookValue = bookValue.minus(booked);
  }
  return out;
}

export interface PeriodDue {
  /** 1-based position of the period among the year's service months (≤ 0: not in service yet). */
  index: number;
  allocatedThrough: Decimal;
  /** What the period books: allocation through the period − booked this year, never negative. */
  due: Decimal;
}

/** AC-9: the amount a run for the period (by its month) books. */
export function periodDue(state: YearState, periodMonth: number): PeriodDue {
  const index = periodMonth - state.firstServiceMonth + 1;
  if (!state.calc || index <= 0) return { index, allocatedThrough: ZERO, due: ZERO };
  const through = allocatedThrough(state.calc.amount, state.months, index);
  return { index, allocatedThrough: through, due: max(ZERO, through.minus(state.booked)) };
}

/**
 * AC-18 / D22: the disposal-year depreciation, min(full × months held ÷ 12 cut to yen, opening book value − memorandum)
 * − booked this year, never negative. Months held run from the first service month of the year to the disposal month.
 */
export function disposalDepreciation(state: YearState, disposalMonth: number, memorandum: Decimal): Decimal {
  if (!state.calc) return ZERO;
  const held = Math.min(state.months, disposalMonth - state.firstServiceMonth + 1);
  if (held <= 0) return ZERO;
  const limit = min(state.calc.full.times(held).div(TWELVE).roundDown(0), state.openingBookValue.minus(memorandum));
  return max(ZERO, limit.minus(state.booked));
}

/** Book value at the end of the walked year after its bookings. */
export function closingBookValue(state: YearState): Decimal {
  return state.openingBookValue.minus(state.booked);
}
