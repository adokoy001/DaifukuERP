// Reads the booked depreciation (docs/specs/fixed-assets.md AC-9, AC-13): fiscal years and periods, submitted runs and
// their lines, submitted disposals. Everything goes through Repository in the caller's Context.
import {
  Decimal,
  DOCSTATUS,
  repo,
  StateError,
  type Context,
  type Domain,
  type Infer,
  type LocalDate,
} from '@daifuku/kernel';
import { FiscalPeriod, FiscalYear } from '@daifuku/mod-accounting';
import { DepreciationRun, DepreciationRunLine } from '../entities/depreciation-run.ts';
import { FixedAssetDisposal } from '../entities/disposal.ts';
import { FixedAsset } from '../entities/fixed-asset.ts';
import type { FiscalYearLike } from './schedule.ts';
import type { PeriodLike } from './periods.ts';

export type AssetRow = Infer<typeof FixedAsset>;
export type RunRow = Infer<typeof DepreciationRun>;
export type DisposalRow = Infer<typeof FixedAssetDisposal>;
export type PeriodRow = PeriodLike & { fiscalYearId: string };

const PAGE = 500;

/** Every row of a list query, 500 at a time (Repository caps a page at 500). */
export async function listAll<T>(
  page: (offset: number) => Promise<{ items: T[]; total: number }>,
  max = 100_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await page(offset);
    out.push(...res.items);
    if (res.items.length < PAGE || out.length >= res.total) break;
    if (out.length >= max)
      throw new StateError('Fixed asset history exceeds the supported range', 'Archive older records first.');
  }
  return out;
}

export async function loadYears(ctx: Context): Promise<FiscalYearLike[]> {
  const rows = await listAll((offset) =>
    repo(ctx, FiscalYear).list({ orderBy: [{ field: 'startDate', dir: 'asc' }], limit: PAGE, offset }),
  );
  return rows.map((y) => ({
    id: y.id,
    code: y.code,
    startDate: y.startDate,
    endDate: y.endDate,
    isClosed: y.isClosed,
  }));
}

export async function loadPeriods(ctx: Context): Promise<PeriodRow[]> {
  const rows = await listAll((offset) =>
    repo(ctx, FiscalPeriod).list({ orderBy: [{ field: 'startDate', dir: 'asc' }], limit: PAGE, offset }),
  );
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    startDate: p.startDate,
    endDate: p.endDate,
    isClosed: p.isClosed,
    fiscalYearId: p.fiscalYearId,
  }));
}

/** Submitted (booked) runs, oldest first. */
export async function liveRuns(ctx: Context, where: Domain = {}): Promise<RunRow[]> {
  return listAll((offset) =>
    repo(ctx, DepreciationRun).list({
      where: { ...where, docstatus: DOCSTATUS.submitted },
      orderBy: [{ field: 'date', dir: 'asc' }],
      limit: PAGE,
      offset,
    }),
  );
}

export interface BookedHistory {
  /** asset id -> fiscal year id -> amount booked by submitted runs. */
  byAsset: Map<string, Map<string, Decimal>>;
  /** asset id -> latest posting date of a submitted run line. */
  lastDate: Map<string, LocalDate>;
}

/** Booked amounts of submitted runs per asset and fiscal year (optionally only for `assetIds`). */
export async function bookedHistory(
  ctx: Context,
  runs: readonly RunRow[],
  assetIds?: readonly string[],
): Promise<BookedHistory> {
  const byAsset = new Map<string, Map<string, Decimal>>();
  const lastDate = new Map<string, LocalDate>();
  const ids = runs.map((r) => r.id);
  for (let i = 0; i < ids.length; i += PAGE) {
    const chunk = ids.slice(i, i + PAGE);
    const where: Domain = { runId: { $in: chunk } };
    if (assetIds) where.assetId = { $in: [...assetIds] };
    if (assetIds && assetIds.length === 0) break;
    const rows = await repo(ctx, DepreciationRunLine).aggregate({
      where,
      groupBy: ['assetId', 'fiscalYearId'],
      metrics: { amount: { sum: 'amount' }, last: { max: 'date' } },
    });
    for (const r of rows) {
      const asset = String(r.assetId);
      const year = String(r.fiscalYearId);
      const perYear = byAsset.get(asset) ?? new Map<string, Decimal>();
      perYear.set(year, (perYear.get(year) ?? Decimal.zero()).plus(r.amount as Decimal));
      byAsset.set(asset, perYear);
      const last = String(r.last);
      if (!lastDate.has(asset) || (lastDate.get(asset) as string) < last) lastDate.set(asset, last);
    }
  }
  return { byAsset, lastDate };
}

/** Lines of submitted runs for `assetIds` (or all) in the given runs. */
export async function runLines(
  ctx: Context,
  runs: readonly RunRow[],
  assetIds?: readonly string[],
): Promise<Infer<typeof DepreciationRunLine>[]> {
  const out: Infer<typeof DepreciationRunLine>[] = [];
  const ids = runs.map((r) => r.id);
  for (let i = 0; i < ids.length; i += PAGE) {
    const where: Domain = { runId: { $in: ids.slice(i, i + PAGE) } };
    if (assetIds) where.assetId = { $in: [...assetIds] };
    out.push(
      ...(await listAll((offset) =>
        repo(ctx, DepreciationRunLine).list({ where, orderBy: [{ field: 'date', dir: 'asc' }], limit: PAGE, offset }),
      )),
    );
  }
  return out;
}

/** Submitted disposals (optionally of one asset). */
export async function liveDisposals(ctx: Context, assetId?: string): Promise<DisposalRow[]> {
  return listAll((offset) =>
    repo(ctx, FixedAssetDisposal).list({
      where: { docstatus: DOCSTATUS.submitted, ...(assetId ? { assetId } : {}) },
      orderBy: [{ field: 'date', dir: 'asc' }],
      limit: PAGE,
      offset,
    }),
  );
}

/** Active assets (status active), code order. */
export async function activeAssets(ctx: Context): Promise<AssetRow[]> {
  return listAll((offset) =>
    repo(ctx, FixedAsset).list({
      where: { status: 'active' },
      orderBy: [{ field: 'code', dir: 'asc' }],
      limit: PAGE,
      offset,
    }),
  );
}

export async function allAssets(ctx: Context): Promise<AssetRow[]> {
  return listAll((offset) =>
    repo(ctx, FixedAsset).list({ orderBy: [{ field: 'code', dir: 'asc' }], limit: PAGE, offset }),
  );
}

export function yearOfDate(years: readonly FiscalYearLike[], date: LocalDate): FiscalYearLike | null {
  return years.find((y) => y.startDate <= date && date <= y.endDate) ?? null;
}
