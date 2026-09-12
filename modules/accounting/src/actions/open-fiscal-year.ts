// accounting.open_fiscal_year (spec AC-2): one fiscal_year plus its 12 monthly fiscal_periods, any start month.
import { defineAction, label, repo, ValidationError, type Context, type Infer, type LocalDate } from '@daifuku/kernel';
import { z } from 'zod';
import { FiscalPeriod } from '../entities/fiscal-period.ts';
import { FiscalYear } from '../entities/fiscal-year.ts';
import { fiscalYearCode, fiscalYearRange, isFirstOfMonth, monthlyPeriods } from '../services/periods.ts';
import { json, localDate } from './helpers.ts';

export interface OpenFiscalYearInput {
  /** First day of the fiscal year; must be the 1st of a month. */
  startDate: LocalDate;
}

export interface OpenFiscalYearResult {
  fiscalYear: Infer<typeof FiscalYear>;
  periods: Infer<typeof FiscalPeriod>[];
}

/** Plain function for seeds and other modules; overlap with an existing year is refused by the fiscal_year hook. */
export async function openFiscalYear(ctx: Context, { startDate }: OpenFiscalYearInput): Promise<OpenFiscalYearResult> {
  if (!isFirstOfMonth(startDate)) {
    throw new ValidationError(`fiscal year must start on the 1st of a month, got ${startDate}`, [{ path: 'startDate', message: 'must be the first day of a month' }], 'Pass e.g. 2026-04-01.');
  }
  const fiscalYear = await repo(ctx, FiscalYear).create({ code: fiscalYearCode(startDate), ...fiscalYearRange(startDate) });
  const periods: Infer<typeof FiscalPeriod>[] = [];
  const periodRepo = repo(ctx, FiscalPeriod);
  for (const p of monthlyPeriods(startDate)) periods.push(await periodRepo.create({ fiscalYearId: fiscalYear.id, ...p }));
  return { fiscalYear, periods };
}

export const openFiscalYearAction = defineAction({
  name: 'accounting.open_fiscal_year',
  description: label(
    '会計年度を開設します。startDate（月初日）から12か月の年度と、月次の会計期間12件を作成します。既存年度と重なる場合は CONFLICT。',
    'Open a fiscal year: 12 months from startDate (the 1st of any month) plus its 12 monthly periods. Overlapping an existing year is a CONFLICT.',
  ),
  input: z.object({ startDate: localDate }),
  output: z.object({ fiscalYear: FiscalYear.schemas.json, periods: z.array(FiscalPeriod.schemas.json) }),
  permission: { entity: FiscalYear.name, op: 'create' },
  handler: async (ctx, input) => {
    const r = await openFiscalYear(ctx, input);
    return { fiscalYear: json(r.fiscalYear), periods: r.periods.map((p) => json(p)) };
  },
});
