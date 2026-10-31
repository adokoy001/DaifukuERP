// fixed_asset_disposal hooks (docs/specs/fixed-assets.md AC-17..AC-20, AC-35; D8, D15, D19, D20, D22). Draft saves
// refresh the computed fields when they can be computed; submit recomputes, validates, posts one entry (disposal-year
// depreciation, removal of the asset, proceeds / output tax / gain or loss) and marks the asset disposed; cancel
// reverses the entry inside the document's fiscal year and makes the asset active again.
import {
  Decimal,
  DOCSTATUS,
  DaifukuError,
  StateError,
  ValidationError,
  registry,
  repo,
  withLock,
  type Context,
  type HookArgs,
  type LocalDate,
} from '@daifuku/kernel';
import { Account, assertJpySettlement, postFromSource, reverseSourceEntry } from '@daifuku/mod-accounting';
import { taxSummaryFor, type TaxCategory } from '@daifuku/mod-tax';
import { FIXED_ASSETS_LOCK, withAssetState } from '../domain-write.ts';
import { FixedAssetDisposal } from '../entities/disposal.ts';
import { FixedAsset, type AssetStatus } from '../entities/fixed-asset.ts';
import { assertRulesUsable, loadRules } from '../rules.ts';
import { loadYears, yearOfDate, type AssetRow } from '../services/history.ts';
import { assetBasis, loadHistory, needsOpening, OPENING_REQUIRED_HINT } from '../services/plan.ts';
import { disposalJournalLines } from '../services/posting.ts';
import { disposalDepreciation, monthIndex, monthStart, walkYears } from '../services/schedule.ts';
import { resolveAccounts } from '../settings.ts';

type Row = Record<string, unknown>;

export const DISPOSED_HINT = 'The asset already has a submitted disposal; cancel it first.';
export const LATER_RUN_HINT =
  'Depreciation is booked for months after the disposal date; cancel those depreciation runs (newest first) or change the date.';

const ZERO = Decimal.zero();
const dec = (v: unknown): Decimal =>
  v === null || v === undefined || v === '' ? ZERO : Decimal.from(v as Decimal | string);
const max0 = (d: Decimal): Decimal => (d.isNegative() ? ZERO : d);

export interface DisposalComputation {
  asset: AssetRow;
  yearDepreciation: Decimal;
  accumulated: Decimal;
  bookValue: Decimal;
  taxCategory: TaxCategory | null;
  taxRate: Decimal | null;
  taxAmount: Decimal;
  gain: Decimal;
  loss: Decimal;
  /** Latest posting date of a submitted run line of the asset (for the later-period check). */
  lastLineDate: LocalDate | null;
}

/** AC-18 / AC-19: the disposal-year depreciation, accumulated depreciation, book value, tax and gain or loss. */
export async function computeDisposal(ctx: Context, row: Row): Promise<DisposalComputation> {
  const asset = await repo(ctx, FixedAsset).get(row.assetId as string);
  const date = row.date as LocalDate;
  const rules = await loadRules(ctx);
  const basis = assetBasis(rules, asset);
  if (!basis)
    throw new StateError(`the depreciation rules have no rate for asset ${asset.code}`, 'Check the asset.', {
      reason: 'rate_missing',
    });
  const years = await loadYears(ctx);
  const year = yearOfDate(years, date);
  if (!year)
    throw new StateError(`no fiscal year contains ${date}`, 'Open the fiscal year with accounting.open_fiscal_year.', {
      date,
    });
  if (needsOpening(asset, years))
    throw new StateError(
      `fixed_asset ${asset.code} went into service before the first fiscal year and has no opening values`,
      OPENING_REQUIRED_HINT,
      { reason: 'opening_required', code: asset.code },
    );
  const { booked } = await loadHistory(ctx, years, [asset.id]);
  const byYear = booked.byAsset.get(asset.id) ?? new Map<string, Decimal>();
  // A submitted disposal of this very document is not part of its own computation (drafts are never submitted).
  const states = walkYears(basis.walk, years, byYear, year.id);
  const state = states[states.length - 1];
  const yearDepreciation =
    state && state.year.id === year.id ? disposalDepreciation(state, monthIndex(date), basis.memorandum) : ZERO;
  const bookedTotal = [...byYear.values()].reduce((s, v) => s.plus(v), ZERO);
  const opening = basis.walk.opening ? basis.walk.opening.accumulated : ZERO;
  const accumulated = opening.plus(bookedTotal).plus(yearDepreciation);
  const cost = dec(asset.cost);
  const bookValue = cost.minus(accumulated);
  const kind = row.kind === 'sale' ? 'sale' : 'retirement';
  const proceeds = dec(row.proceeds);
  let taxCategory: TaxCategory | null = null;
  let taxRate: Decimal | null = null;
  let taxAmount = ZERO;
  if (kind === 'sale') {
    taxCategory = ((row.taxCategory as TaxCategory | null) ?? 'standard') as TaxCategory;
    const summary = await taxSummaryFor(ctx, {
      date,
      lines: [{ amount: proceeds, category: taxCategory }],
      priceIncludesTax: false,
    });
    taxAmount = summary.totals.tax;
    taxRate = summary.groups[0]?.rate ?? ZERO;
  }
  return {
    asset,
    yearDepreciation,
    accumulated,
    bookValue,
    taxCategory,
    taxRate,
    taxAmount,
    gain: kind === 'sale' ? max0(proceeds.minus(bookValue)) : ZERO,
    loss: kind === 'sale' ? max0(bookValue.minus(proceeds)) : bookValue,
    lastLineDate: booked.lastDate.get(asset.id) ?? null,
  };
}

function applyComputed(row: Row, c: DisposalComputation | null): void {
  row.disposalYearDepreciation = c?.yearDepreciation ?? null;
  row.accumulatedDepreciation = c?.accumulated ?? null;
  row.bookValue = c?.bookValue ?? null;
  row.taxRate = c?.taxRate ?? null;
  row.taxAmount = c ? (row.kind === 'sale' ? c.taxAmount : null) : null;
  row.gain = c?.gain ?? null;
  row.loss = c?.loss ?? null;
}

async function fillDefaults(ctx: Context, row: Row): Promise<void> {
  if (row.kind !== 'sale') return;
  if (!row.taxCategory) row.taxCategory = 'standard';
  if (!row.proceedsAccountId) {
    try {
      row.proceedsAccountId = (await resolveAccounts(ctx, ['proceeds'])).proceeds.id;
    } catch (error) {
      if (!(error instanceof DaifukuError)) throw error;
    }
  }
}

/** AC-17: draft saves store what can be computed; anything that cannot be computed stays empty. */
async function onDraftSave(ctx: Context, { row }: HookArgs): Promise<void> {
  await fillDefaults(ctx, row);
  let computed: DisposalComputation | null = null;
  try {
    computed = await computeDisposal(ctx, row);
  } catch (error) {
    if (!(error instanceof DaifukuError)) throw error;
  }
  applyComputed(row, computed);
}

async function assertSubmittable(ctx: Context, row: Row, c: DisposalComputation, priorStatus: string): Promise<void> {
  const issues: { path: string; message: string }[] = [];
  const date = row.date as LocalDate;
  const proceeds = dec(row.proceeds);
  if (!proceeds.eq(proceeds.roundDown(0))) issues.push({ path: 'proceeds', message: 'must be whole yen' });
  if (date < c.asset.acquisitionDate)
    issues.push({ path: 'date', message: `must be on or after the acquisition date ${c.asset.acquisitionDate}` });
  if (row.kind === 'sale') {
    if (!proceeds.gt(0)) issues.push({ path: 'proceeds', message: 'a sale needs proceeds above 0' });
    if (!row.proceedsAccountId) issues.push({ path: 'proceedsAccountId', message: 'required for a sale' });
    else {
      const account = await repo(ctx, Account).get(row.proceedsAccountId as string);
      if (account.partnerRequired && !row.partnerId)
        issues.push({ path: 'partnerId', message: `account ${account.code} requires a partner` });
    }
  } else if (!proceeds.isZero()) issues.push({ path: 'proceeds', message: 'a retirement has no proceeds (0)' });
  if (issues.length > 0) throw new ValidationError('fixed_asset_disposal cannot be submitted', issues);
  const other = await repo(ctx, FixedAssetDisposal).count({
    assetId: row.assetId as string,
    docstatus: DOCSTATUS.submitted,
    id: { $ne: row.id as string },
  });
  if (other > 0 || priorStatus === 'disposed')
    throw new StateError(`fixed_asset ${c.asset.code} is already disposed`, DISPOSED_HINT, {
      reason: 'already_disposed',
    });
  const monthEnd = monthStart(monthIndex(date) + 1);
  if (c.lastLineDate && c.lastLineDate >= monthEnd)
    throw new StateError(`depreciation of ${c.asset.code} is booked after ${date}`, LATER_RUN_HINT, {
      reason: 'later_depreciation',
      lastLineDate: c.lastLineDate,
    });
}

/**
 * Lock order (ADR-0020): the asset row first, then the company lock — the order of an asset edit (the kernel's FOR NO
 * KEY UPDATE on the row, then the asset hook's company lock). The state write takes the row lock at NO KEY UPDATE
 * strength, so the run lines' FK KEY SHARE is not blocked; a refusal below rolls the state back with the transaction.
 * The other-disposal count under the company lock is the authoritative "already disposed" check.
 */
async function setAssetState(
  ctx: Context,
  assetId: string,
  state: { status: AssetStatus; disposedOn: LocalDate | null },
) {
  const prior = await repo(ctx, FixedAsset).get(assetId);
  await withAssetState(ctx, (inner) => repo(inner, FixedAsset).update(assetId, state));
  await withLock(ctx, FIXED_ASSETS_LOCK, async () => undefined);
  return prior;
}

async function onBeforeSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  const prior = await setAssetState(ctx, row.assetId as string, {
    status: 'disposed',
    disposedOn: row.date as LocalDate,
  });
  const rules = await loadRules(ctx);
  await assertRulesUsable(ctx, rules);
  await fillDefaults(ctx, row);
  const c = await computeDisposal(ctx, row);
  await assertSubmittable(ctx, row, c, prior.status);
  applyComputed(row, c);
  const proceeds = dec(row.proceeds);
  await assertJpySettlement(ctx, proceeds.plus(c.taxAmount));
  const accounts = await resolveAccounts(ctx, ['lossOnRetirement', 'gainOnSale', 'lossOnSale', 'outputTax']);
  const memo = `${row.kind === 'sale' ? '売却' : '除却'} ${c.asset.code} ${c.asset.name}`;
  const lines = disposalJournalLines({
    kind: row.kind === 'sale' ? 'sale' : 'retirement',
    cost: dec(c.asset.cost),
    yearDepreciation: c.yearDepreciation,
    accumulated: c.accumulated,
    bookValue: c.bookValue,
    accounts: {
      asset: c.asset.assetAccountId,
      accumulated: c.asset.accumulatedAccountId as string,
      expense: c.asset.expenseAccountId as string,
      lossOnRetirement: accounts.lossOnRetirement.id,
      gainOnSale: accounts.gainOnSale.id,
      lossOnSale: accounts.lossOnSale.id,
      outputTax: accounts.outputTax.id,
      proceeds: (row.proceedsAccountId as string | null) ?? null,
    },
    proceeds,
    tax: c.taxAmount,
    taxCategory: c.taxCategory,
    taxRate: c.taxRate,
    partnerId: (row.partnerId as string | null) ?? null,
    memo,
  });
  const entry = await postFromSource(ctx, {
    sourceEntity: FixedAssetDisposal.name,
    sourceId: row.id as string,
    date: row.date as LocalDate,
    description: memo,
    lines,
  });
  row.journalEntryId = entry.id;
}

async function onBeforeCancel(ctx: Context, { row, correctionDate }: HookArgs): Promise<void> {
  await setAssetState(ctx, row.assetId as string, { status: 'active', disposedOn: null });
  if (correctionDate) {
    const year = yearOfDate(await loadYears(ctx), row.date as LocalDate);
    if (year && (correctionDate < year.startDate || correctionDate > year.endDate))
      throw new ValidationError(
        `correction date ${correctionDate} is outside fiscal year ${year.code}`,
        [{ path: 'correctionDate', message: `must be within ${year.startDate}..${year.endDate}` }],
        'The reversal must be dated inside the fiscal year of the disposal (the register counts it in that year).',
      );
  }
  if (typeof row.journalEntryId !== 'string')
    throw new StateError('Source posting link is missing', 'Repair the source linkage before cancelling.');
  await reverseSourceEntry(ctx, {
    id: row.journalEntryId,
    sourceEntity: FixedAssetDisposal.name,
    sourceId: row.id as string,
    date: correctionDate,
  });
}

export function registerDisposalHooks(): void {
  registry.registerHook(FixedAssetDisposal.name, 'before_create', onDraftSave);
  registry.registerHook(FixedAssetDisposal.name, 'before_update', onDraftSave);
  registry.registerHook(FixedAssetDisposal.name, 'before_submit', onBeforeSubmit);
  registry.registerHook(FixedAssetDisposal.name, 'before_cancel', onBeforeCancel);
}
