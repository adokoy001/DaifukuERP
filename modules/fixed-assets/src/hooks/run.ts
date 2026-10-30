// depreciation_run hooks (docs/specs/fixed-assets.md AC-12, AC-13, AC-16; D6, D20, D21). Runs are created only by
// fixed_assets.run_depreciation (generic create / duplicate are refused); submit re-checks "once per asset and period"
// and posts one entry through accounting.postFromSource; cancel reverses it, newest run first, inside the run's year.
import {
  Decimal,
  DOCSTATUS,
  StateError,
  ValidationError,
  hasWriteCapability,
  registry,
  repo,
  withLock,
  type Context,
  type HookArgs,
  type LocalDate,
} from '@daifuku/kernel';
import { FiscalYear, postFromSource, reverseSourceEntry } from '@daifuku/mod-accounting';
import { FIXED_ASSETS_LOCK } from '../domain-write.ts';
import { DepreciationRun, DepreciationRunLine } from '../entities/depreciation-run.ts';
import { FixedAssetDisposal } from '../entities/disposal.ts';
import { liveRuns, runLines } from '../services/history.ts';
import { runJournalLines } from '../services/posting.ts';

export const USE_SCREEN_HINT =
  'Depreciation runs are created by fixed_assets.run_depreciation (the /finance/depreciation screen); they cannot be created or duplicated by hand.';
export const CANCEL_ORDER_HINT =
  'Cancel the later runs first, newest first: cancelling a run in the middle would leave the same-year runs unable to book the shortfall.';
export const DISPOSED_CANCEL_HINT = 'Cancel the disposal of the asset first, then cancel this run.';
export const CORRECTION_YEAR_HINT =
  'The reversal must be dated inside the fiscal year of the run: the register counts depreciation by the fiscal year of the run.';

type Row = Record<string, unknown>;

async function loadRunLines(ctx: Context, runId: string) {
  return (
    await repo(ctx, DepreciationRunLine).list({ where: { runId }, orderBy: [{ field: 'seq', dir: 'asc' }], limit: 500 })
  ).items;
}

/** before_validate (create only: no `previous`) and before_create: refuse writes without the module capability. */
function refuseGenericCreate(ctx: Context, { entity, previous }: HookArgs): void {
  if (previous) return;
  if (!hasWriteCapability(ctx, entity, 'create'))
    throw new StateError(`${entity} cannot be created directly`, USE_SCREEN_HINT, {
      reason: 'use_depreciation_screen',
    });
}

/** AC-13: lines of other submitted runs for the same assets and period. */
async function alreadyBooked(ctx: Context, row: Row, assetIds: readonly string[]): Promise<string[]> {
  const others = (await liveRuns(ctx, { periodId: row.periodId as string })).filter((r) => r.id !== row.id);
  if (others.length === 0) return [];
  const lines = await runLines(ctx, others, assetIds);
  return [...new Set(lines.map((l) => l.assetId))];
}

async function onBeforeSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  await withLock(ctx, FIXED_ASSETS_LOCK, async () => undefined);
  const lines = await loadRunLines(ctx, row.id as string);
  if (lines.length === 0)
    throw new ValidationError('depreciation_run has no lines', [{ path: 'lines', message: 'at least one line' }]);
  const dup = await alreadyBooked(
    ctx,
    row,
    lines.map((l) => l.assetId),
  );
  if (dup.length > 0)
    throw new StateError('depreciation is already booked for these assets in the period', USE_SCREEN_HINT, {
      reason: 'already_booked',
      assetIds: dup,
    });
  const total = lines.reduce((s, l) => s.plus(l.amount), Decimal.zero());
  const entry = await postFromSource(ctx, {
    sourceEntity: DepreciationRun.name,
    sourceId: row.id as string,
    date: row.date as LocalDate,
    description: `減価償却 ${String(row.date).slice(0, 7)}`,
    lines: runJournalLines(lines, `減価償却 ${String(row.date).slice(0, 7)}`),
  });
  row.journalEntryId = entry.id;
  row.totalAmount = total;
  row.assetCount = lines.length;
}

async function onBeforeCancel(ctx: Context, { row, correctionDate }: HookArgs): Promise<void> {
  await withLock(ctx, FIXED_ASSETS_LOCK, async () => undefined);
  const lines = await loadRunLines(ctx, row.id as string);
  const assetIds = [...new Set(lines.map((l) => l.assetId))];
  const disposed = assetIds.length
    ? await repo(ctx, FixedAssetDisposal).list({
        where: { assetId: { $in: assetIds }, docstatus: DOCSTATUS.submitted },
        limit: 500,
      })
    : { items: [] };
  if (disposed.items.length > 0)
    throw new StateError(`assets of ${String(row.number)} have a submitted disposal`, DISPOSED_CANCEL_HINT, {
      reason: 'asset_disposed',
      disposals: disposed.items.map((d) => d.number),
    });
  const later = (await liveRuns(ctx)).filter((r) => r.id !== row.id && r.date > (row.date as string));
  if (later.length > 0 && assetIds.length > 0) {
    const laterLines = await runLines(ctx, later, assetIds);
    const runIds = new Set(laterLines.map((l) => l.runId));
    const numbers = later.filter((r) => runIds.has(r.id)).map((r) => r.number ?? r.id);
    if (numbers.length > 0)
      throw new StateError(`later depreciation runs book the same assets: ${numbers.join(', ')}`, CANCEL_ORDER_HINT, {
        reason: 'later_runs',
        runs: numbers,
      });
  }
  if (correctionDate) {
    const year = await repo(ctx, FiscalYear).get(row.fiscalYearId as string);
    if (correctionDate < year.startDate || correctionDate > year.endDate)
      throw new ValidationError(
        `correction date ${correctionDate} is outside fiscal year ${year.code}`,
        [{ path: 'correctionDate', message: `must be within ${year.startDate}..${year.endDate}` }],
        CORRECTION_YEAR_HINT,
      );
  }
  if (typeof row.journalEntryId !== 'string')
    throw new StateError('Source posting link is missing', 'Repair the source linkage before cancelling.');
  await reverseSourceEntry(ctx, {
    id: row.journalEntryId,
    sourceEntity: DepreciationRun.name,
    sourceId: row.id as string,
    date: correctionDate,
  });
}

export function registerRunHooks(): void {
  for (const entity of [DepreciationRun.name, DepreciationRunLine.name]) {
    registry.registerHook(entity, 'before_validate', refuseGenericCreate);
    registry.registerHook(entity, 'before_create', refuseGenericCreate);
  }
  registry.registerHook(DepreciationRun.name, 'before_submit', onBeforeSubmit);
  registry.registerHook(DepreciationRun.name, 'before_cancel', onBeforeCancel);
}
