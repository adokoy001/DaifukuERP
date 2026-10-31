// fixed_assets.preview_depreciation / fixed_assets.run_depreciation (docs/specs/fixed-assets.md AC-11..AC-15, AC-35;
// D5, D6, D13, D14, D18). The preview never writes; the run books, under the company lock, every asset whose amount for
// the period is above zero and that has no submitted line in the period yet: one run document, one journal entry.
import {
  can,
  Decimal,
  defineAction,
  label,
  repo,
  saveLines,
  StateError,
  submitDocument,
  todayLocal,
  withLock,
  type Context,
} from '@daifuku/kernel';
import { Account, assertOpenPeriod, FiscalPeriod, JournalEntry } from '@daifuku/mod-accounting';
import { z } from 'zod';
import { FIXED_ASSETS_LOCK, withRunWrite } from '../domain-write.ts';
import { DepreciationRun, DepreciationRunLine } from '../entities/depreciation-run.ts';
import { FixedAsset } from '../entities/fixed-asset.ts';
import { assertRulesUsable, loadRules, rulesConfirmation } from '../rules.ts';
import type { PeriodRow, RunRow } from '../services/history.ts';
import { defaultPeriod } from '../services/periods.ts';
import { loadCalendar, MAX_RUN_ASSETS, planForPeriod, SKIP_REASONS, type Calendar } from '../services/plan.ts';
import { assertPeriodRunnable, assertPlanRunnable, BLOCKERS, blockersOf } from '../services/run-checks.ts';

export const NO_PERIOD_HINT = 'Open a fiscal year with accounting.open_fiscal_year first.';

const money = z.string();
const previewLine = z.object({
  assetId: z.string(),
  code: z.string(),
  name: z.string(),
  method: z.string(),
  usefulLife: z.number().int(),
  openingBookValue: money,
  annualAmount: money,
  bookedInYear: money,
  amount: money,
  expenseAccountId: z.string(),
  accumulatedAccountId: z.string(),
  /** Account codes for the screen's 科目 column (AC-32); null when the caller cannot read accounts. */
  expenseAccountCode: z.string().nullable(),
  accumulatedAccountCode: z.string().nullable(),
  switched: z.boolean(),
});
const runSummary = z.object({
  id: z.string(),
  number: z.string().nullable(),
  journalEntryId: z.string().nullable(),
  journalEntryNumber: z.string().nullable(),
  totalAmount: money,
  assetCount: z.number().int(),
});

export const previewOutput = z.object({
  period: z.object({
    id: z.string(),
    code: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    isClosed: z.boolean(),
    isFuture: z.boolean(),
  }),
  fiscalYear: z.object({ id: z.string(), code: z.string(), isClosed: z.boolean() }),
  defaulted: z.boolean(),
  rules: z.object({
    id: z.string(),
    verifiedOn: z.string().nullable(),
    confirmedOn: z.string().nullable(),
    usable: z.boolean(),
  }),
  lines: z.array(previewLine),
  total: money,
  assetCount: z.number().int(),
  overLimit: z.boolean(),
  runs: z.array(runSummary),
  skipped: z.object(Object.fromEntries(SKIP_REASONS.map((r) => [r, z.number().int()])) as Record<string, z.ZodNumber>),
  priorYearPending: z.object({ count: z.number().int(), total: money, periodId: z.string() }).nullable(),
  /** Why a run of this period would be refused (empty: it can run). */
  blockers: z.array(z.enum(BLOCKERS)),
});
export type DepreciationPreview = z.infer<typeof previewOutput>;

async function runSummaries(ctx: Context, runs: readonly RunRow[]): Promise<z.infer<typeof runSummary>[]> {
  const ids = runs.map((r) => r.journalEntryId).filter((v): v is string => typeof v === 'string');
  const entries = ids.length
    ? (await repo(ctx, JournalEntry).list({ where: { id: { $in: ids } }, limit: 500 })).items
    : [];
  const numbers = new Map(entries.map((e) => [e.id, e.number]));
  return runs.map((r) => ({
    id: r.id,
    number: r.number,
    journalEntryId: r.journalEntryId ?? null,
    journalEntryNumber: r.journalEntryId ? (numbers.get(r.journalEntryId) ?? null) : null,
    totalAmount: Decimal.from(r.totalAmount).toString(),
    assetCount: r.assetCount,
  }));
}

function resolvePeriod(calendar: Calendar, periodId: string | undefined, ctx: Context): PeriodRow {
  if (calendar.periods.length === 0)
    throw new StateError('the company has no fiscal period', NO_PERIOD_HINT, { reason: 'no_fiscal_period' });
  const period = periodId
    ? calendar.periods.find((p) => p.id === periodId)
    : defaultPeriod(calendar.periods, todayLocal(ctx.now()));
  if (!period)
    throw new StateError(`fiscal period ${periodId} not found`, NO_PERIOD_HINT, { reason: 'no_fiscal_period' });
  return period;
}

/** Codes of the accounts of the shown lines (at most 2 × 500 ids). */
async function accountCodes(ctx: Context, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0 || !can(ctx, Account, 'read')) return new Map();
  const out = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const found = await repo(ctx, Account).list({ where: { id: { $in: chunk } }, limit: chunk.length });
    for (const a of found.items) out.set(a.id, a.code);
  }
  return out;
}

/** AC-11: the preview of a period (default: the last period that ended before today, D14). */
export async function previewDepreciation(ctx: Context, input: { periodId?: string | undefined }) {
  const calendar = await loadCalendar(ctx);
  if (input.periodId) await repo(ctx, FiscalPeriod).get(input.periodId);
  const period = resolvePeriod(calendar, input.periodId, ctx);
  const rules = await loadRules(ctx);
  const confirmation = await rulesConfirmation(ctx, rules);
  const plan = await planForPeriod(ctx, rules, calendar, period);
  const today = todayLocal(ctx.now());
  const total = plan.lines.reduce((s, l) => s.plus(l.amount), Decimal.zero());
  const shown = plan.lines.slice(0, MAX_RUN_ASSETS);
  const codes = await accountCodes(
    ctx,
    shown.flatMap((l) => [l.asset.expenseAccountId as string, l.asset.accumulatedAccountId as string]),
  );
  return {
    period: {
      id: period.id,
      code: period.code,
      startDate: period.startDate,
      endDate: period.endDate,
      isClosed: period.isClosed,
      isFuture: period.startDate > today,
    },
    fiscalYear: { id: plan.year.id, code: plan.year.code, isClosed: plan.year.isClosed },
    defaulted: !input.periodId,
    rules: {
      id: rules.id,
      verifiedOn: rules.verifiedOn,
      confirmedOn: confirmation.confirmedOn,
      usable: confirmation.usable,
    },
    lines: shown.map((l) => ({
      assetId: l.asset.id,
      code: l.asset.code,
      name: l.asset.name,
      method: l.asset.method,
      usefulLife: l.asset.usefulLife,
      openingBookValue: l.openingBookValue.toString(),
      annualAmount: l.annualAmount.toString(),
      bookedInYear: l.bookedInYear.toString(),
      amount: l.amount.toString(),
      expenseAccountId: l.asset.expenseAccountId as string,
      accumulatedAccountId: l.asset.accumulatedAccountId as string,
      expenseAccountCode: codes.get(l.asset.expenseAccountId as string) ?? null,
      accumulatedAccountCode: codes.get(l.asset.accumulatedAccountId as string) ?? null,
      switched: l.switched,
    })),
    total: total.toString(),
    assetCount: plan.lines.length,
    overLimit: plan.lines.length > MAX_RUN_ASSETS,
    runs: await runSummaries(ctx, plan.runs),
    skipped: plan.skipped,
    priorYearPending: plan.priorYearPending
      ? { ...plan.priorYearPending, total: plan.priorYearPending.total.toString() }
      : null,
    blockers: blockersOf(plan, calendar.periods, today, confirmation.usable),
  };
}

export const previewDepreciationAction = defineAction({
  name: 'fixed_assets.preview_depreciation',
  description: label(
    '会計期間の減価償却を試算します（データは変更しません）。periodId を省略すると、今日より前に終わった最後の会計期間を使います。',
    'Preview the depreciation of a fiscal period without changing data. Without periodId, the last period that ended before today is used.',
  ),
  input: z.object({ periodId: z.uuid().optional() }),
  output: previewOutput,
  permission: { entity: FixedAsset.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: previewDepreciation,
});

export const runOutput = z.object({
  created: z.boolean(),
  run: runSummary.optional(),
  existingRuns: z.array(runSummary).optional(),
  rulesVerified: z.boolean(),
});

/** AC-12..AC-15: book the period's depreciation once per asset and period. */
export async function runDepreciation(ctx: Context, input: { periodId: string }) {
  await withLock(ctx, FIXED_ASSETS_LOCK, async () => undefined);
  await repo(ctx, FiscalPeriod).get(input.periodId);
  const calendar = await loadCalendar(ctx);
  const period = resolvePeriod(calendar, input.periodId, ctx);
  const year = calendar.years.find((y) => y.id === period.fiscalYearId);
  if (!year) throw new StateError(`fiscal year of ${period.code} not found`, NO_PERIOD_HINT);
  await assertOpenPeriod(ctx, period.endDate);
  assertPeriodRunnable(period, year, calendar.periods, todayLocal(ctx.now()));
  const rules = await loadRules(ctx);
  await assertRulesUsable(ctx, rules);
  const plan = await planForPeriod(ctx, rules, calendar, period, { withPriorYear: false });
  const rulesVerified = rules.verifiedOn !== null;
  assertPlanRunnable(plan);
  if (plan.lines.length === 0)
    return { created: false, existingRuns: await runSummaries(ctx, plan.runs), rulesVerified };
  const total = plan.lines.reduce((s, l) => s.plus(l.amount), Decimal.zero());
  const draft = await withRunWrite(ctx, async (inner) => {
    const head = await repo(inner, DepreciationRun).create({
      periodId: period.id,
      fiscalYearId: year.id,
      date: period.endDate,
      totalAmount: total,
      assetCount: plan.lines.length,
      ruleSetId: rules.id,
    });
    await saveLines(inner, DepreciationRun, head.id, {
      [DepreciationRunLine.name]: plan.lines.map((l, i) => ({
        seq: i + 1,
        assetId: l.asset.id,
        periodId: period.id,
        fiscalYearId: year.id,
        date: period.endDate,
        amount: l.amount,
        annualAmount: l.annualAmount,
        expenseAccountId: l.asset.expenseAccountId,
        accumulatedAccountId: l.asset.accumulatedAccountId,
        basis: l.basis,
      })),
    });
    return head;
  });
  const submitted = await submitDocument(ctx, DepreciationRun, draft.id);
  const [summary] = await runSummaries(ctx, [submitted as RunRow]);
  return { created: true, run: summary, rulesVerified };
}

export const runDepreciationAction = defineAction({
  name: 'fixed_assets.run_depreciation',
  description: label(
    '会計期間の減価償却を実行し、償却の実行（depreciation_run）と仕訳を 1 本作ります。資産と期間の組ごとに 1 回だけ計上し、計上するものが無ければ何も作りません（created: false）。',
    'Book the depreciation of a fiscal period as one depreciation_run and one journal entry. Each asset is booked once per period; when nothing is due nothing is created (created: false).',
  ),
  input: z.object({ periodId: z.uuid() }),
  output: runOutput,
  permission: { entity: DepreciationRun.name, op: 'submit' },
  handler: runDepreciation,
});
