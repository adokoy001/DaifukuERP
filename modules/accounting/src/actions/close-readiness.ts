// accounting.close_readiness (docs/specs/close-guide.md AC-1..AC-7): what is left before a fiscal period can be closed.
// Read-only. Every count goes through Repository.count in the caller's context, so role grants, row rules, field
// masks, the company/site boundary and pack activation all apply; an entity the caller cannot read is left out
// entirely (AC-7). Other modules are found through the registry by name (payment and banking depend on accounting,
// not the other way round), and each is skipped when it is not registered, not readable or lacks the expected fields.
import {
  can,
  canRunAction,
  defineAction,
  DOCSTATUS,
  label,
  maskedFields,
  registry,
  repo,
  StateError,
  todayLocal,
  type Context,
  type Domain,
  type EntityDef,
  type Label,
  type LocalDate,
} from '@daifuku/kernel';
import { z } from 'zod';
import { FiscalPeriod } from '../entities/fiscal-period.ts';
import { FiscalYear } from '../entities/fiscal-year.ts';
import {
  blockingCount,
  closeDateField,
  closeReady,
  defaultClosePeriod,
  isBlockingDraft,
  previousPeriod,
  type ClosePeriodLike,
} from '../services/close.ts';

const CLOSE_ROLES = ['accounting', 'admin'] as const;
/** `details.reason` of the StateError raised when the company has no fiscal period yet (the page explains it). */
export const NO_FISCAL_PERIOD = 'no_fiscal_period';
/** Page size for the bank statement ids whose active reconciliations are counted. */
const STATEMENT_PAGE = 500;

const labelSchema = z.object({ ja: z.string(), en: z.string() });
const ITEM_KINDS = ['draft', 'unallocated_payment', 'unreconciled_statement', 'previous_period'] as const;
type ItemKind = (typeof ITEM_KINDS)[number];

export const closeReadinessItem = z.object({
  id: z.string(),
  kind: z.enum(ITEM_KINDS),
  label: labelSchema,
  count: z.number().int().min(0),
  blocking: z.boolean(),
  /** Web path of the list to work from (the generic list until it can filter, docs/specs/close-guide.md AC-9). */
  href: z.string().optional(),
  entity: z.string().optional(),
  /** What the count covers, so a filtering list (or an MCP caller) can reproduce it. */
  filter: z.object({ status: z.literal('draft'), field: z.string(), from: z.string(), to: z.string() }).optional(),
});
export type CloseReadinessItem = z.infer<typeof closeReadinessItem>;

const periodJson = z.object({
  id: z.string(),
  code: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  isClosed: z.boolean(),
});

export const closeReadinessOutput = z.object({
  period: periodJson,
  fiscalYear: z.object({ id: z.string(), code: z.string(), isClosed: z.boolean() }),
  /** True when periodId was omitted and the AC-8 default was used. */
  defaulted: z.boolean(),
  asOf: z.string(),
  items: z.array(closeReadinessItem),
  blockingCount: z.number().int().min(0),
  ready: z.boolean(),
  /** Report actions the caller can run, with the period's dates as input (AC-8). */
  reports: z.array(z.object({ action: z.string(), label: labelSchema, input: z.record(z.string(), z.string()) })),
});
export type CloseReadiness = z.infer<typeof closeReadinessOutput>;

/** AC-8: the reports the close guide links to, with the period's range or end date as their input. */
const CLOSE_REPORTS: readonly { action: string; label: Label; input: 'range' | 'asOf' }[] = [
  { action: 'accounting.trial_balance', label: label('試算表', 'Trial balance'), input: 'range' },
  { action: 'accounting.general_ledger', label: label('総勘定元帳', 'General ledger'), input: 'range' },
  { action: 'accounting.tax_period_summary', label: label('消費税集計表', 'Consumption tax summary'), input: 'range' },
  { action: 'sales.ar_aging', label: label('売掛金年齢表', 'Receivables aging'), input: 'asOf' },
  { action: 'purchase.ap_aging', label: label('買掛金年齢表', 'Payables aging'), input: 'asOf' },
  { action: 'inventory.valuation', label: label('在庫評価', 'Inventory valuation'), input: 'asOf' },
];

/** Registered, readable by the caller (roles, store/site scope, applied packs) and none of `fields` masked. */
function readable(ctx: Context, entity: EntityDef, fields: readonly string[]): boolean {
  if (!can(ctx, entity, 'read')) return false;
  const masked = maskedFields(ctx, entity);
  return fields.every((field) => !masked.has(field) && !entity.config.fields[field]?.opts.outputHidden);
}

function readableByName(ctx: Context, name: string, fields: readonly string[]): EntityDef | undefined {
  if (!registry.hasEntity(name)) return undefined;
  const entity = registry.entity(name);
  const declared = fields.every((field) => field in entity.config.fields || field in entity.columns);
  return declared && readable(ctx, entity, fields) ? entity : undefined;
}

function entityLabel(ctx: Context, entity: EntityDef): Label {
  return registry.labelOverrides(entity.name, ctx.appliedPacks ?? [])?.entity ?? entity.config.label;
}

const inRange = (field: string, from: LocalDate, to: LocalDate): Domain => ({
  $and: [{ [field]: { $gte: from } }, { [field]: { $lte: to } }],
});

/** AC-2 / AC-3: one item per readable document dated by a business-date field, counting drafts in the period. */
async function draftItems(ctx: Context, period: ClosePeriodLike): Promise<CloseReadinessItem[]> {
  const items: CloseReadinessItem[] = [];
  for (const entity of registry.allEntities()) {
    if (entity.kind !== 'document') continue;
    const field = closeDateField(entity.config.fields);
    if (!field || !readable(ctx, entity, [field, 'docstatus'])) continue;
    const count = await repo(ctx, entity).count({
      docstatus: DOCSTATUS.draft,
      ...inRange(field, period.startDate, period.endDate),
    });
    const name = entityLabel(ctx, entity);
    items.push({
      id: `draft:${entity.name}`,
      kind: 'draft',
      label: label(`${name.ja}の下書き`, `${name.en} drafts`),
      count,
      blocking: isBlockingDraft(entity.name, entity.config.fields),
      href: `/e/${entity.name}`,
      entity: entity.name,
      filter: { status: 'draft', field, from: period.startDate, to: period.endDate },
    });
  }
  return items;
}

/** AC-4: submitted payments dated up to the period end that still carry an unallocated amount. */
async function unallocatedPayments(ctx: Context, period: ClosePeriodLike): Promise<CloseReadinessItem | undefined> {
  const payment = readableByName(ctx, 'payment', ['date', 'docstatus', 'unallocatedAmount']);
  if (!payment) return undefined;
  const count = await repo(ctx, payment).count({
    docstatus: DOCSTATUS.submitted,
    date: { $lte: period.endDate },
    unallocatedAmount: { $gt: '0' },
  });
  return {
    id: 'unallocated_payments',
    kind: 'unallocated_payment',
    label: label('未配分額が残る確定済みの入出金', 'Submitted payments with an unallocated amount'),
    count,
    blocking: false,
    href: `/e/${payment.name}`,
    entity: payment.name,
  };
}

/**
 * AC-4: bank statement lines booked in the period without an active reconciliation. A statement has at most one
 * active reconciliation (banking refuses a second), so unmatched = statements − active reconciliations of them.
 */
async function unreconciledStatements(ctx: Context, period: ClosePeriodLike): Promise<CloseReadinessItem | undefined> {
  const statement = readableByName(ctx, 'bank_statement', ['bookedOn']);
  const reconciliation = readableByName(ctx, 'bank_reconciliation', ['statementId', 'state']);
  if (!statement || !reconciliation) return undefined;
  const where = inRange('bookedOn', period.startDate, period.endDate);
  const total = await repo(ctx, statement).count(where);
  let matched = 0;
  for (let offset = 0; offset < total; offset += STATEMENT_PAGE) {
    const page = await repo(ctx, statement).list({
      where,
      orderBy: [{ field: 'id', dir: 'asc' }],
      limit: STATEMENT_PAGE,
      offset,
    });
    if (page.items.length === 0) break;
    matched += await repo(ctx, reconciliation).count({
      state: 'active',
      statementId: { $in: page.items.map((row) => String(row.id)) },
    });
  }
  return {
    id: 'unreconciled_bank_statements',
    kind: 'unreconciled_statement',
    label: label('照合していない銀行明細', 'Bank statement lines not yet matched'),
    count: Math.max(0, total - matched),
    blocking: false,
    href: '/finance/banking',
    entity: statement.name,
  };
}

/** The first fiscal period matching `where` in start-date order (`desc`: the last one), if any. */
async function firstPeriod(ctx: Context, where: Domain, dir: 'asc' | 'desc') {
  const page = await repo(ctx, FiscalPeriod).list({ where, orderBy: [{ field: 'startDate', dir }], limit: 1 });
  return page.items[0];
}

const present = <T>(value: T | undefined): value is T => value !== undefined;

/**
 * AC-8 default without reading every period: each rule of defaultClosePeriod answered by one targeted query, so
 * picking among these candidates gives the same period as picking among all of them, however many there are.
 */
async function defaultPeriod(ctx: Context, today: LocalDate) {
  const candidates = [
    await firstPeriod(ctx, { isClosed: false, endDate: { $lt: today } }, 'asc'),
    await firstPeriod(ctx, { startDate: { $lte: today }, endDate: { $gte: today } }, 'asc'),
    await firstPeriod(ctx, { endDate: { $lt: today } }, 'desc'),
    await firstPeriod(ctx, {}, 'asc'),
  ].filter(present);
  return defaultClosePeriod(candidates, today);
}

/**
 * AC-5: the preceding period (the last to start among those ending before this one starts, across fiscal years),
 * counted 1 while it is still open. The label is neutral because the count reads as a state (open 1 / closed 0).
 * Omitted when there is no earlier period.
 */
async function previousPeriodItem(ctx: Context, period: ClosePeriodLike): Promise<CloseReadinessItem | undefined> {
  const before = await firstPeriod(ctx, { endDate: { $lt: period.startDate } }, 'desc');
  const previous = previousPeriod([before].filter(present), period);
  if (!previous) return undefined;
  return {
    id: 'previous_period_open',
    kind: 'previous_period',
    label: label(`前の会計期間（${previous.code}）の締め`, `Close of the previous period (${previous.code})`),
    count: previous.isClosed ? 0 : 1,
    blocking: false,
    href: `/finance/close?periodId=${previous.id}`,
  };
}

const KIND_ORDER: Record<ItemKind, number> = {
  previous_period: 0,
  draft: 1,
  unallocated_payment: 2,
  unreconciled_statement: 3,
};

/** Blocking items first; the journal's own drafts lead; then by kind and entity name (stable for tests and UI). */
function ordered(items: readonly CloseReadinessItem[]): CloseReadinessItem[] {
  const rank = (item: CloseReadinessItem) => (item.entity === 'journal_entry' ? -1 : KIND_ORDER[item.kind]);
  return [...items].sort(
    (a, b) =>
      Number(b.blocking) - Number(a.blocking) ||
      rank(a) - rank(b) ||
      (a.entity ?? a.id).localeCompare(b.entity ?? b.id),
  );
}

function reportLinks(ctx: Context, period: ClosePeriodLike): CloseReadiness['reports'] {
  return CLOSE_REPORTS.filter(
    (report) => registry.hasAction(report.action) && canRunAction(ctx, registry.action(report.action)),
  ).map((report) => ({
    action: report.action,
    label: report.label,
    input: report.input === 'range' ? { from: period.startDate, to: period.endDate } : { asOf: period.endDate },
  }));
}

export async function closeReadiness(ctx: Context, periodId: string | undefined): Promise<CloseReadiness> {
  const today = todayLocal(ctx.now());
  const period = periodId ? await repo(ctx, FiscalPeriod).get(periodId) : await defaultPeriod(ctx, today);
  if (!period)
    throw new StateError(
      'no fiscal period exists yet',
      'Open a fiscal year with accounting.open_fiscal_year; its monthly periods appear here.',
      { reason: NO_FISCAL_PERIOD },
    );
  const year = await repo(ctx, FiscalYear).get(period.fiscalYearId);
  const extra = [
    await previousPeriodItem(ctx, period),
    await unallocatedPayments(ctx, period),
    await unreconciledStatements(ctx, period),
  ].filter((item): item is CloseReadinessItem => item !== undefined);
  const items = ordered([...(await draftItems(ctx, period)), ...extra]);
  return {
    period: {
      id: period.id,
      code: period.code,
      startDate: period.startDate,
      endDate: period.endDate,
      isClosed: period.isClosed,
    },
    fiscalYear: { id: year.id, code: year.code, isClosed: year.isClosed },
    defaulted: !periodId,
    asOf: today,
    items,
    blockingCount: blockingCount(items),
    ready: closeReady(period.isClosed, items),
    reports: reportLinks(ctx, period),
  };
}

export const closeReadinessAction = defineAction({
  name: 'accounting.close_readiness',
  description: label(
    '月次締めの点検: 会計期間（省略時は終了日が今日より前の最も古い未締め期間、無ければ今日を含む期間）について、期間内の下書き伝票（仕訳と、仕訳を作る伝票は締めを止める項目）、未配分の入出金、未照合の銀行明細、前の期間の締め状態を件数で返します。読めない伝票は含めません。ready が true のときだけ accounting.close_period で締めてください。',
    'Month-end close check for a fiscal period (default: the oldest open period that ended before today, else the one containing today): drafts dated in the period per document type (journal entries and documents that post one block the close), submitted payments with an unallocated amount, unmatched bank statement lines and whether the previous period is closed. Documents the caller cannot read are left out. Close with accounting.close_period only when ready is true.',
  ),
  input: z.object({ periodId: z.uuid().optional() }),
  output: closeReadinessOutput,
  permission: { roles: CLOSE_ROLES },
  tx: 'none',
  mutates: false,
  handler: (ctx, { periodId }) => closeReadiness(ctx, periodId),
});
