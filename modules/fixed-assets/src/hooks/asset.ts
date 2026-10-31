// fixed_asset hooks (docs/specs/fixed-assets.md AC-1..AC-5, AC-10, AC-28). Every save (form, REST, MCP, CSV import)
// fills the empty accounts and property-tax class, derives depreciationStart, validates against the country rules and
// the fiscal calendar, and freezes the financial fields once a run line or disposal is booked. Saves never post.
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
import { Account } from '@daifuku/mod-accounting';
import { DepreciationRunLine } from '../entities/depreciation-run.ts';
import { FixedAssetDisposal } from '../entities/disposal.ts';
import { FixedAsset } from '../entities/fixed-asset.ts';
import { FIXED_ASSETS_LOCK } from '../domain-write.ts';
import {
  defaultPropertyTaxClass,
  loadRules,
  memorandumFor,
  methodAllowed,
  selectRate,
  type AssetClass,
  type DepreciationMethod,
  type DepreciationRuleSet,
} from '../rules.ts';
import { liveRuns, loadPeriods, loadYears } from '../services/history.ts';
import { monthIndex, monthStart } from '../services/schedule.ts';
import { resolveAccounts } from '../settings.ts';

type Row = Record<string, unknown>;
type Issue = { path: string; message: string };

/** AC-4: fields that stay editable after depreciation or a disposal is booked. */
export const ALWAYS_EDITABLE = ['name', 'location', 'municipality', 'propertyTaxClass', 'memo'] as const;
const BOOKKEEPING = new Set(['updatedAt', 'updatedBy', 'version', 'createdAt', 'createdBy']);
/** Written by the disposal hooks through the module capability (exempt from the freeze). */
const STATE_FIELDS = new Set(['status', 'disposedOn']);

export const FROZEN_HINT =
  'Only name, location, municipality, property-tax class and memo can change after depreciation or a disposal is booked. Cancel the runs and the disposal first (newest first) to correct the other fields.';
export const IN_USE_HINT =
  'Depreciation run lines or disposals refer to this asset; it stays in the register. Correct it instead of deleting it.';

const dec = (v: unknown): Decimal | null =>
  v === null || v === undefined || v === '' ? null : Decimal.from(v as Decimal | string);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Decimal || b instanceof Decimal) {
    const x = dec(a);
    const y = dec(b);
    return x === null || y === null ? x === y : x.eq(y);
  }
  if (a instanceof Date || b instanceof Date) return String(a) === String(b);
  if (typeof a === 'object' && a !== null) return JSON.stringify(a) === JSON.stringify(b);
  return (a ?? null) === (b ?? null);
}

export function changedFields(previous: Row, row: Row): string[] {
  return Object.keys(row).filter((k) => !BOOKKEEPING.has(k) && !same(previous[k], row[k]));
}

/** AC-4: a submitted run line or a submitted disposal refers to the asset. */
export async function hasBookedHistory(ctx: Context, assetId: string): Promise<boolean> {
  if ((await repo(ctx, FixedAssetDisposal).count({ assetId, docstatus: DOCSTATUS.submitted })) > 0) return true;
  const runs = await liveRuns(ctx);
  for (let i = 0; i < runs.length; i += 500) {
    const runIds = runs.slice(i, i + 500).map((r) => r.id);
    if ((await repo(ctx, DepreciationRunLine).count({ assetId, runId: { $in: runIds } })) > 0) return true;
  }
  return false;
}

/** AC-1: the first day of the month of the later of the in-service date and the opening date (null if not in service). */
export function depreciationStartOf(inServiceDate: LocalDate | null, openingDate: LocalDate | null): LocalDate | null {
  if (!inServiceDate) return null;
  const later = openingDate && openingDate > inServiceDate ? openingDate : inServiceDate;
  return monthStart(monthIndex(later));
}

async function fillAccounts(ctx: Context, row: Row): Promise<void> {
  const software = row.assetClass === 'software';
  const roles: ('accumulated' | 'expense')[] = [];
  if (!str(row.accumulatedAccountId) && !software) roles.push('accumulated');
  if (!str(row.expenseAccountId)) roles.push('expense');
  if (!str(row.accumulatedAccountId) && software && str(row.assetAccountId))
    row.accumulatedAccountId = row.assetAccountId;
  if (roles.length === 0) return;
  const found = await resolveAccounts(ctx, roles);
  if (found.accumulated && !str(row.accumulatedAccountId)) row.accumulatedAccountId = found.accumulated.id;
  if (found.expense && !str(row.expenseAccountId)) row.expenseAccountId = found.expense.id;
}

async function accountIssues(ctx: Context, row: Row): Promise<Issue[]> {
  const want: [string, string][] = [
    ['assetAccountId', 'asset'],
    ['accumulatedAccountId', 'asset'],
    ['expenseAccountId', 'expense'],
  ];
  const ids = [...new Set(want.map(([k]) => str(row[k])).filter((v): v is string => v !== null))];
  const found = ids.length ? await repo(ctx, Account).list({ where: { id: { $in: ids } }, limit: ids.length }) : null;
  const types = new Map((found?.items ?? []).map((a) => [a.id, a.type]));
  const issues: Issue[] = [];
  for (const [key, type] of want) {
    const id = str(row[key]);
    if (!id) {
      issues.push({ path: key, message: 'required (set it or the fixed_assets.accounts setting)' });
      continue;
    }
    const actual = types.get(id);
    if (actual !== undefined && actual !== type)
      issues.push({ path: key, message: `must be an account of type ${type} (got ${actual})` });
  }
  return issues;
}

/** AC-2 (b)..(d): rules-based checks of one asset; returns the memorandum value when the rules cover it. */
export function ruleIssues(rules: DepreciationRuleSet, row: Row): { issues: Issue[]; memorandum: Decimal | null } {
  const issues: Issue[] = [];
  const acquisitionDate = row.acquisitionDate as LocalDate;
  const assetClass = row.assetClass as AssetClass;
  const method = row.method as DepreciationMethod;
  const cost = dec(row.cost);
  const memorandum = memorandumFor(rules, assetClass, acquisitionDate);
  if (!memorandum)
    issues.push({ path: 'acquisitionDate', message: 'the depreciation rules have no memorandum value for this date' });
  if (cost && !cost.eq(cost.roundDown(0))) issues.push({ path: 'cost', message: 'must be whole yen' });
  else if (cost && memorandum && cost.lte(memorandum))
    issues.push({ path: 'cost', message: `must exceed the memorandum value ${memorandum.toString()}` });
  const hasTable = rules.rateTables.some(
    (t) =>
      t.method === method &&
      t.acquiredFrom <= acquisitionDate &&
      (t.acquiredTo === null || acquisitionDate <= t.acquiredTo),
  );
  if (!hasTable)
    issues.push({
      path: 'acquisitionDate',
      message: `no ${method} rate table applies to assets acquired on ${acquisitionDate} (not supported)`,
    });
  else if (!selectRate(rules, method, Number(row.usefulLife), acquisitionDate))
    issues.push({
      path: 'usefulLife',
      message: `the ${method} rate table has no row for ${String(row.usefulLife)} years`,
    });
  if (!methodAllowed(rules, assetClass, method, acquisitionDate))
    issues.push({
      path: 'method',
      message: `${method} is not allowed for ${assetClass} acquired on ${acquisitionDate}`,
    });
  return { issues, memorandum };
}

/** AC-3: opening values against the fiscal calendar and the declining-balance switch. */
async function openingIssues(
  ctx: Context,
  rules: DepreciationRuleSet,
  row: Row,
  memorandum: Decimal | null,
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const openingDate = str(row.openingDate);
  const inService = str(row.inServiceDate);
  const accumulated = dec(row.openingAccumulatedDepreciation) ?? Decimal.zero();
  const yearDep = dec(row.openingYearDepreciation) ?? Decimal.zero();
  const revisedBase = dec(row.openingRevisedBase);
  const cost = dec(row.cost) ?? Decimal.zero();
  const years = await loadYears(ctx);
  if (!openingDate) {
    if (!accumulated.isZero() || !yearDep.isZero() || revisedBase)
      issues.push({ path: 'openingDate', message: 'opening values need an opening date' });
    if (inService && years.length > 0) {
      const earliestOpen = years.find((y) => !y.isClosed);
      const serviceMonth = monthStart(monthIndex(inService));
      const inClosed = years.some((y) => y.isClosed && y.startDate <= inService && inService <= y.endDate);
      if (inClosed || !earliestOpen || serviceMonth < earliestOpen.startDate)
        issues.push({
          path: 'openingDate',
          message:
            'the asset went into service before the earliest open fiscal year: enter the opening date and the accumulated depreciation up to it (closed years cannot be depreciated)',
        });
    }
    return issues;
  }
  if (years.length === 0) {
    issues.push({
      path: 'openingDate',
      message: 'the company has no fiscal year; open one before entering opening values',
    });
    return issues;
  }
  const periods = await loadPeriods(ctx);
  const period = periods.find((p) => p.startDate === openingDate);
  const year = period ? years.find((y) => y.id === period.fiscalYearId) : undefined;
  if (!period || !year) {
    issues.push({ path: 'openingDate', message: 'must be the first day of a fiscal period of the company' });
    return issues;
  }
  if (year.isClosed) issues.push({ path: 'openingDate', message: `fiscal year ${year.code} is closed` });
  if (accumulated.isNegative()) issues.push({ path: 'openingAccumulatedDepreciation', message: 'must be 0 or more' });
  if (memorandum && accumulated.gt(cost.minus(memorandum)))
    issues.push({
      path: 'openingAccumulatedDepreciation',
      message: `must not exceed cost − memorandum value (${cost.minus(memorandum).toString()})`,
    });
  if (yearDep.isNegative() || yearDep.gt(accumulated))
    issues.push({
      path: 'openingYearDepreciation',
      message: 'must be between 0 and the opening accumulated depreciation',
    });
  if (openingDate === year.startDate && !yearDep.isZero())
    issues.push({
      path: 'openingYearDepreciation',
      message: 'must be 0 when the opening date is the first day of the year',
    });
  if (row.method !== 'declining_200') {
    if (revisedBase) issues.push({ path: 'openingRevisedBase', message: 'only for the declining-balance method' });
    return issues;
  }
  const rate = selectRate(rules, 'declining_200', Number(row.usefulLife), row.acquisitionDate as LocalDate);
  if (!rate || !rate.guaranteeRate || !rate.revisedRate) return issues;
  const openingBookValue = cost.minus(accumulated).plus(yearDep);
  const unadjusted = openingBookValue.times(rate.rate);
  const guarantee = cost.times(rate.guaranteeRate);
  if (unadjusted.lt(guarantee) && !revisedBase)
    issues.push({
      path: 'openingRevisedBase',
      message:
        'the declining balance has switched to the revised rate: enter the revised base (改定取得価額) if it switched before the opening, or the opening book value if it switches in this year',
    });
  if (!unadjusted.lt(guarantee) && revisedBase)
    issues.push({
      path: 'openingRevisedBase',
      message: 'the asset has not switched to the revised rate yet; leave it empty',
    });
  return issues;
}

async function onSave(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  const capabilityWrite = hasWriteCapability(ctx, FixedAsset.name, 'update');
  if (previous) {
    const changed = changedFields(previous, row);
    if (capabilityWrite && changed.every((k) => STATE_FIELDS.has(k))) return;
    // AC-4: the always-editable fields need neither the history check nor the company lock (lock order, ADR-0020).
    if (changed.every((k) => (ALWAYS_EDITABLE as readonly string[]).includes(k))) {
      if (changed.includes('propertyTaxClass') && !str(row.propertyTaxClass)) {
        const rules = await loadRules(ctx);
        row.propertyTaxClass = defaultPropertyTaxClass(rules, row.assetClass as AssetClass);
      }
      return;
    }
    // The kernel holds the asset row (FOR NO KEY UPDATE) here; the company lock comes second, as in the disposal hooks.
    await withLock(ctx, FIXED_ASSETS_LOCK, async () => undefined);
    const frozen = changed.filter(
      (k) => !(ALWAYS_EDITABLE as readonly string[]).includes(k) && k !== 'depreciationStart' && !STATE_FIELDS.has(k),
    );
    if (frozen.length > 0 && (await hasBookedHistory(ctx, row.id as string)))
      throw new StateError(
        `fixed_asset ${String(row.code)} has booked depreciation or a disposal; ${frozen.join(', ')} cannot change`,
        FROZEN_HINT,
        { reason: 'asset_frozen', fields: frozen },
      );
  }
  const rules = await loadRules(ctx);
  await fillAccounts(ctx, row);
  if (!str(row.propertyTaxClass)) row.propertyTaxClass = defaultPropertyTaxClass(rules, row.assetClass as AssetClass);
  row.depreciationStart = depreciationStartOf(str(row.inServiceDate), str(row.openingDate));
  const issues: Issue[] = [];
  const inService = str(row.inServiceDate);
  if (inService && (row.acquisitionDate as string) > inService)
    issues.push({ path: 'inServiceDate', message: 'must be on or after the acquisition date' });
  const checked = ruleIssues(rules, row);
  issues.push(...checked.issues);
  issues.push(...(await accountIssues(ctx, row)));
  issues.push(...(await openingIssues(ctx, rules, row, checked.memorandum)));
  if (issues.length > 0) throw new ValidationError(`fixed_asset ${String(row.code)}: invalid values`, issues);
}

async function onDelete(ctx: Context, { row }: HookArgs): Promise<void> {
  const assetId = row.id as string;
  const lines = await repo(ctx, DepreciationRunLine).count({ assetId });
  const disposals = await repo(ctx, FixedAssetDisposal).count({ assetId });
  if (lines > 0 || disposals > 0)
    throw new StateError(`fixed_asset ${String(row.code)} is referenced by depreciation or a disposal`, IN_USE_HINT, {
      reason: 'asset_in_use',
      lines,
      disposals,
    });
}

export function registerAssetHooks(): void {
  registry.registerHook(FixedAsset.name, 'before_create', onSave);
  registry.registerHook(FixedAsset.name, 'before_update', onSave);
  registry.registerHook(FixedAsset.name, 'before_delete', onDelete);
}
