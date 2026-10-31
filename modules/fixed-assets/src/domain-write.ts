// Module-private write capabilities (ADR-0016): server-owned fields of fixed_asset, depreciation_run and its lines are
// written only through these. Capabilities never widen role permissions; the caller still needs the entity op.
import { defineWriteCapability, withWriteCapability, type Context } from '@daifuku/kernel';

const assetState = defineWriteCapability({
  name: 'fixed_assets.asset_state',
  entity: 'fixed_asset',
  fields: ['status', 'disposedOn'],
  operations: ['update'],
});
const runCreate = defineWriteCapability({
  name: 'fixed_assets.run',
  entity: 'depreciation_run',
  fields: ['periodId', 'fiscalYearId', 'date', 'totalAmount', 'assetCount', 'ruleSetId'],
  operations: ['create'],
});
const runLines = defineWriteCapability({
  name: 'fixed_assets.run_lines',
  entity: 'depreciation_run_line',
  fields: [
    'runId',
    'seq',
    'assetId',
    'periodId',
    'fiscalYearId',
    'date',
    'amount',
    'annualAmount',
    'expenseAccountId',
    'accumulatedAccountId',
    'basis',
  ],
  operations: ['create'],
});

export const withAssetState = <T>(ctx: Context, work: (ctx: Context) => Promise<T>): Promise<T> =>
  withWriteCapability(ctx, assetState, work);

/** Both run capabilities: the run header and its lines are created together by fixed_assets.run_depreciation. */
export const withRunWrite = <T>(ctx: Context, work: (ctx: Context) => Promise<T>): Promise<T> =>
  withWriteCapability(ctx, runCreate, (c) => withWriteCapability(c, runLines, work));

/** One lock key for runs, cancellations, disposals and financial edits of assets (AC-13). */
export const FIXED_ASSETS_LOCK = 'fixed-assets';
