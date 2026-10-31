// Reads of the cash forecast (docs/specs/cash-forecast.md AC-9, AC-14, AC-18, AC-29, AC-30), all through the caller's
// repository: no system context and no widened role. A scheduled source is included only when the caller reads every
// entity it needs without a row rule and without hidden fields (payroll also needs export); otherwise it is left out
// and reported as excluded. The ledger, cash accounts, payments and partner names are required reads, so a missing
// permission there surfaces as the repository's PERMISSION_DENIED.
import {
  assertReadableFields,
  can,
  Decimal,
  DOCSTATUS,
  PermissionDenied,
  registry,
  repo,
  rowFilter,
  StateError,
  type Context,
  type Domain,
  type EntityDef,
  type ListQuery,
  type ListResult,
  type LocalDate,
} from '@daifuku/kernel';
import { Account, JournalLine, movementsByAccount } from '@daifuku/mod-accounting';
import { plannedContractReceipts, type ContractCashPlan } from '@daifuku/mod-contract';
import { Partner } from '@daifuku/mod-partner';
import { loadPaymentAccountCodes, Payment, PAYMENT_ACCOUNTS_KEY } from '@daifuku/mod-payment';
import { PurchaseInvoice } from '@daifuku/mod-purchase';
import { SalesInvoice } from '@daifuku/mod-sales';
import { payrollCashSchedule, type PayrollCashSchedule } from '@daifuku/mod-workforce';
import { readKeyset, type EntryCursor, type PlannedItem, type PostedEntry } from './cash-plan.ts';
import type { CashForecastFacts, SourceStatus } from './cash-tables.ts';
import { CASH_SOURCES, type CashNotice, type CashSource } from './contract.ts';
import { BankAccount, BankTransfer, BankTransferReservation } from './entities.ts';

const PAGE = 500;
const ID_CHUNK = 200;
/** The aggregate port's per-call group cap (kernel/src/repository/aggregate.ts). */
export const AGGREGATE_PAGE = 10_000;

/** Entities and fields each scheduled source reads (AC-14). */
export const SOURCE_READS: Readonly<Record<CashSource, readonly { entity: string; fields: readonly string[] }[]>> = {
  sales_invoice: [
    { entity: 'sales_invoice', fields: ['number', 'partnerId', 'date', 'dueDate', 'balance', 'total', 'docstatus'] },
  ],
  purchase_invoice: [
    { entity: 'purchase_invoice', fields: ['number', 'partnerId', 'date', 'dueDate', 'balance', 'total', 'docstatus'] },
  ],
  bank_transfer: [
    { entity: 'purchase_invoice', fields: ['number', 'partnerId', 'date', 'dueDate', 'balance', 'docstatus'] },
    { entity: 'bank_transfer_reservation', fields: ['batchId', 'invoiceId', 'active'] },
    { entity: 'bank_transfer', fields: ['transferDate', 'state'] },
  ],
  contract: [
    {
      entity: 'contract',
      fields: [
        'number',
        'partnerId',
        'startDate',
        'endDate',
        'billingDay',
        'billingTiming',
        'intervalMonths',
        'prorationRule',
        'roundingMode',
        'status',
        'docstatus',
      ],
    },
    {
      entity: 'contract_line',
      fields: ['contractId', 'seq', 'productId', 'description', 'quantity', 'unitPrice', 'taxCategory'],
    },
    { entity: 'contract_billing', fields: ['contractId', 'period'] },
    { entity: 'tax_rate', fields: ['category', 'rate', 'validFrom', 'validTo', 'code', 'label'] },
  ],
  payroll: [
    { entity: 'workforce_payroll', fields: ['period', 'netPay', 'docstatus'] },
    { entity: 'workforce_payroll_tax_evidence', fields: ['payrollId', 'paymentDate'] },
  ],
};

/** Sources that also need export on every entity they read (AC-14: payroll, so a caller who cannot put payroll in a
 * CSV does not see it on the screen either). */
export const SOURCE_NEEDS_EXPORT: ReadonlySet<CashSource> = new Set<CashSource>(['payroll']);

/**
 * AC-14 for one entity: read without a row rule (kernel rowFilter undefined), every used field readable (no role mask,
 * no output-hidden field) and, when asked, export.
 */
export function entityAllows(ctx: Context, entity: EntityDef, fields: readonly string[], needExport: boolean): boolean {
  if (!can(ctx, entity, 'read') || rowFilter(ctx, entity, 'read') !== undefined) return false;
  if (needExport && !can(ctx, entity, 'export')) return false;
  try {
    assertReadableFields(ctx, entity, fields);
    return true;
  } catch (error) {
    if (error instanceof PermissionDenied) return false;
    throw error;
  }
}

/**
 * AC-14: whether the caller may see a source in full (payroll also needs export). `reads` is SOURCE_READS; the unit
 * test passes a probe entity there to reach the export rule with a role no real module defines.
 */
export function sourceIncluded(
  ctx: Context,
  source: CashSource,
  reads: Readonly<Record<CashSource, readonly { entity: string; fields: readonly string[] }[]>> = SOURCE_READS,
): boolean {
  return reads[source].every(
    ({ entity, fields }) =>
      registry.hasEntity(entity) && entityAllows(ctx, registry.entity(entity), fields, SOURCE_NEEDS_EXPORT.has(source)),
  );
}

export function sourceStatuses(ctx: Context): SourceStatus[] {
  return CASH_SOURCES.map((source) => ({ source, included: sourceIncluded(ctx, source) }));
}

/**
 * Every row matching `where`, keyset-paged on id. A row that leaves the filter between two pages (an invoice paid
 * meanwhile) cannot shift the later pages, so no row that still matches is skipped, which offset paging would do.
 */
export async function allById<T extends { id: string }>(
  list: (q: ListQuery) => Promise<ListResult<T>>,
  where: Domain,
): Promise<T[]> {
  const out: T[] = [];
  for (let after: string | undefined; ;) {
    const page = await list({
      where: after === undefined ? where : { $and: [where, { id: { $gt: after } }] },
      orderBy: [{ field: 'id', dir: 'asc' }],
      limit: PAGE,
    });
    out.push(...page.items);
    const last = page.items.at(-1);
    if (page.items.length < PAGE || last === undefined) return out;
    after = last.id;
  }
}

async function inChunks<T>(ids: readonly string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const unique = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK) out.push(...(await fn(unique.slice(i, i + ID_CHUNK))));
  return out;
}

const asDate = (value: unknown): LocalDate => String(value).slice(0, 10);

/** Open documents due up to `to` (a missing due date falls back to the document date, D-4). */
function dueUpTo(to: LocalDate): Domain {
  return { $or: [{ dueDate: { $lte: to } }, { dueDate: null, date: { $lte: to } }] };
}

type InvoiceEntity = typeof SalesInvoice | typeof PurchaseInvoice;

/** Open documents (`to` given: only those due up to `to`). */
async function invoices(ctx: Context, entity: InvoiceEntity, docstatus: number, to: LocalDate | undefined) {
  const r = repo(ctx, entity as typeof SalesInvoice);
  const where: Domain = {
    docstatus,
    ...(docstatus === DOCSTATUS.submitted ? { balance: { $ne: '0' } } : { total: { $ne: '0' } }),
    ...(to === undefined ? {} : dueUpTo(to)),
  };
  return allById((q) => r.list(q), where);
}

/** Purchase invoice id -> transfer date of its active reservation in a prepared/exported transfer file (D-4). */
async function reservedTransfers(ctx: Context, invoiceIds: readonly string[]): Promise<Map<string, LocalDate>> {
  const reservations = await inChunks(invoiceIds, (chunk) =>
    allById((q) => repo(ctx, BankTransferReservation).list(q), { invoiceId: { $in: chunk }, active: true }),
  );
  const batches = await inChunks(
    reservations.map((r) => r.batchId),
    (chunk) =>
      allById((q) => repo(ctx, BankTransfer).list(q), {
        id: { $in: chunk },
        state: { $in: ['prepared', 'exported'] },
      }),
  );
  const dates = new Map(batches.map((b) => [b.id, b.transferDate]));
  const out = new Map<string, LocalDate>();
  for (const r of reservations) {
    const date = dates.get(r.batchId);
    if (date !== undefined) out.set(r.invoiceId, date);
  }
  return out;
}

async function partnerNames(ctx: Context, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = ids.filter((id): id is string => id !== null);
  const rows = await inChunks(
    wanted,
    async (chunk) => (await repo(ctx, Partner).list({ where: { id: { $in: chunk } }, limit: chunk.length })).items,
  );
  return new Map(rows.map((p) => [p.id, p.name]));
}

function item(partial: Partial<PlannedItem> & Pick<PlannedItem, 'source' | 'state' | 'dueDate' | 'amount' | 'key'>) {
  return {
    documentDueDate: null,
    count: 1,
    number: null,
    period: null,
    partnerId: null,
    partnerName: null,
    salesInvoiceId: null,
    purchaseInvoiceId: null,
    contractId: null,
    ...partial,
  } satisfies PlannedItem;
}

/** Contract receipts as scheduled items (D-4 `contract`). */
export function contractItems(plan: Pick<ContractCashPlan, 'receipts'>): PlannedItem[] {
  return plan.receipts.map((r) =>
    item({
      source: 'contract',
      state: 'submitted',
      dueDate: r.dueDate,
      amount: r.total,
      number: r.contractNumber,
      period: r.period,
      partnerId: r.partnerId,
      contractId: r.contractId,
      key: `${r.contractId}:${r.period}`,
    }),
  );
}

/** Payroll payment days as scheduled items (D-4 `payroll`): one item per date, no employee information. */
export function payrollItems(schedule: Pick<PayrollCashSchedule, 'days'>): PlannedItem[] {
  return schedule.days.map((day) =>
    item({
      source: 'payroll',
      state: 'submitted',
      dueDate: day.paymentDate,
      amount: day.netPay,
      count: day.count,
      key: day.paymentDate,
    }),
  );
}

export interface ScheduledItems {
  items: PlannedItem[];
  unscheduledPayroll?: { count: number; netPay: Decimal };
  contractBacklog?: { count: number; subtotal: Decimal };
}

/**
 * Every scheduled item of the included sources (D-4, D-7), shared by both actions (AC-4). Drafts are read only when
 * asked. Items scheduled after `to` are left out here; the rest of the placement (D-5) happens in cash-plan.ts.
 */
export async function loadScheduledItems(
  ctx: Context,
  q: { today: LocalDate; to: LocalDate; includeDrafts: boolean; included: ReadonlySet<CashSource> },
): Promise<ScheduledItems> {
  const items: PlannedItem[] = [];
  const out: ScheduledItems = { items };
  if (q.included.has('sales_invoice')) {
    const states = q.includeDrafts ? [DOCSTATUS.submitted, DOCSTATUS.draft] : [DOCSTATUS.submitted];
    for (const docstatus of states)
      for (const inv of await invoices(ctx, SalesInvoice, docstatus, q.to))
        items.push(
          item({
            source: 'sales_invoice',
            state: docstatus === DOCSTATUS.submitted ? 'submitted' : 'draft',
            dueDate: inv.dueDate ?? inv.date,
            amount: docstatus === DOCSTATUS.submitted ? inv.balance : inv.total,
            number: inv.number,
            partnerId: inv.partnerId,
            salesInvoiceId: inv.id,
            key: inv.id,
          }),
        );
  }
  if (q.included.has('purchase_invoice') || q.included.has('bank_transfer')) {
    // A reserved invoice is placed on its transfer date, which may come before its due date (paying early is normal),
    // so with transfers every open invoice is read whatever its due date (D-4 `bank_transfer` has no due condition).
    const withTransfers = q.included.has('bank_transfer');
    const open = await invoices(ctx, PurchaseInvoice, DOCSTATUS.submitted, withTransfers ? undefined : q.to);
    const reserved = withTransfers
      ? await reservedTransfers(
          ctx,
          open.map((inv) => inv.id),
        )
      : new Map<string, LocalDate>();
    for (const inv of open) {
      const transferDate = reserved.get(inv.id);
      if (transferDate === undefined && !q.included.has('purchase_invoice')) continue;
      const scheduled = transferDate ?? inv.dueDate ?? inv.date;
      if (scheduled > q.to) continue; // D-5 (1)
      items.push(
        item({
          source: transferDate === undefined ? 'purchase_invoice' : 'bank_transfer',
          state: 'submitted',
          dueDate: scheduled,
          documentDueDate: transferDate === undefined ? null : (inv.dueDate ?? inv.date),
          amount: inv.balance,
          number: inv.number,
          partnerId: inv.partnerId,
          purchaseInvoiceId: inv.id,
          key: inv.id,
        }),
      );
    }
    if (q.includeDrafts && q.included.has('purchase_invoice'))
      for (const inv of await invoices(ctx, PurchaseInvoice, DOCSTATUS.draft, q.to))
        items.push(
          item({
            source: 'purchase_invoice',
            state: 'draft',
            dueDate: inv.dueDate ?? inv.date,
            amount: inv.total,
            number: inv.number,
            partnerId: inv.partnerId,
            purchaseInvoiceId: inv.id,
            key: inv.id,
          }),
        );
  }
  if (q.included.has('contract')) {
    const plan = await plannedContractReceipts(ctx, { today: q.today, to: q.to });
    items.push(...contractItems(plan));
    out.contractBacklog = plan.backlog;
  }
  if (q.included.has('payroll')) {
    const payroll = await payrollCashSchedule(ctx, { today: q.today, to: q.to });
    items.push(...payrollItems(payroll));
    out.unscheduledPayroll = payroll.unscheduled;
  }
  const names = await partnerNames(
    ctx,
    items.map((i) => i.partnerId),
  );
  for (const i of items) if (i.partnerId !== null) i.partnerName = names.get(i.partnerId) ?? null;
  return out;
}

export interface CashLedger {
  ledgerBalance: Decimal;
  cashAccounts: CashForecastFacts['cashAccounts'];
  cashAccountIds: Set<string>;
  missingAccountCodes: string[];
  posted: PostedEntry[];
}

/** D-2: cash and bank codes of payment.accounts plus the ledger accounts of every bank account; AC-18. */
async function resolveCashAccounts(ctx: Context) {
  const codes = await loadPaymentAccountCodes(ctx);
  const wanted = [...new Set([codes.cash, codes.bank])];
  const byCode = (await repo(ctx, Account).list({ where: { code: { $in: wanted } }, limit: wanted.length })).items;
  const bankAccounts = await allById((q) => repo(ctx, BankAccount).list(q), {});
  const known = new Set(byCode.map((a) => a.id));
  const extra = await inChunks(
    bankAccounts.map((b) => b.ledgerAccountId).filter((id) => !known.has(id)),
    async (chunk) => (await repo(ctx, Account).list({ where: { id: { $in: chunk } }, limit: chunk.length })).items,
  );
  const accounts = [...byCode, ...extra].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const found = new Set(byCode.map((a) => a.code));
  const missing = wanted.filter((code) => !found.has(code));
  if (accounts.length === 0)
    throw new StateError(
      '資金科目が見つかりません。',
      `会社設定 ${PAYMENT_ACCOUNTS_KEY} の現金・普通預金のコードを確認するか、銀行口座を登録してください。`,
      { setting: PAYMENT_ACCOUNTS_KEY, missing },
    );
  return { accounts, missing };
}

/** One page of posted cash lines grouped per journal entry, after the cursor (AC-9). */
function postedPage(ctx: Context, ids: readonly string[], from: LocalDate, to: LocalDate) {
  return async (after: EntryCursor | undefined): Promise<PostedEntry[]> => {
    const rows = await repo(ctx, JournalLine).aggregate({
      where: {
        posted: true,
        accountId: { $in: [...ids] },
        $and: [
          { entryDate: { $gte: from } },
          { entryDate: { $lte: to } },
          ...(after
            ? [
                {
                  $or: [
                    { entryDate: { $gt: after.entryDate } },
                    { entryDate: after.entryDate, entryId: { $gt: after.entryId } },
                  ],
                },
              ]
            : []),
        ],
      },
      groupBy: ['entryDate', 'entryId'],
      metrics: { debit: { sum: 'debit' }, credit: { sum: 'credit' } },
      orderBy: [
        { field: 'entryDate', dir: 'asc' },
        { field: 'entryId', dir: 'asc' },
      ],
      limit: AGGREGATE_PAGE,
    });
    return rows.map((r) => ({
      entryDate: asDate(r.entryDate),
      entryId: String(r.entryId),
      debit: r.debit as Decimal,
      credit: r.credit as Decimal,
    }));
  };
}

/** Cash accounts, the balance before `from` per account and the posted movements of from..to (D-2, D-3, D-6). */
export async function loadCashLedger(ctx: Context, q: { from: LocalDate; to: LocalDate }): Promise<CashLedger> {
  const { accounts, missing } = await resolveCashAccounts(ctx);
  const ids = accounts.map((a) => a.id);
  const opening = await movementsByAccount(ctx, { entryDate: { $lt: q.from }, accountId: { $in: ids } });
  const cashAccounts = accounts.map((a) => {
    const m = opening.get(a.id);
    return { accountId: a.id, code: a.code, name: a.name, balance: m ? m.debit.minus(m.credit) : Decimal.zero() };
  });
  return {
    ledgerBalance: Decimal.sum(cashAccounts.map((a) => a.balance)),
    cashAccounts,
    cashAccountIds: new Set(ids),
    missingAccountCodes: missing,
    posted: await readKeyset(postedPage(ctx, ids, q.from, q.to), AGGREGATE_PAGE),
  };
}

/** AC-29 / AC-30: payments whose cash may be double counted or not counted at all (notes; no balance change). */
export async function loadPaymentNotes(
  ctx: Context,
  q: { to: LocalDate; cashAccountIds: ReadonlySet<string> },
): Promise<Pick<CashForecastFacts, 'unallocated' | 'uncountedPaymentAccounts'>> {
  const advances = await repo(ctx, Payment).aggregate({
    where: { docstatus: DOCSTATUS.submitted, unallocatedAmount: { $gt: '0' } },
    groupBy: ['direction'],
    metrics: { count: { count: true }, amount: { sum: 'unallocatedAmount' } },
  });
  const advance = (direction: string) => {
    const row = advances.find((r) => r.direction === direction);
    return { count: row ? Number(row.count) : 0, amount: row ? (row.amount as Decimal) : Decimal.zero() };
  };
  const byAccount = await repo(ctx, Payment).aggregate({
    where: { docstatus: DOCSTATUS.submitted, date: { $lte: q.to } },
    groupBy: ['accountId', 'direction'],
    metrics: { count: { count: true }, amount: { sum: 'amount' } },
  });
  const outside = new Map<string, { count: number; receive: Decimal; pay: Decimal }>();
  for (const row of byAccount) {
    const accountId = String(row.accountId);
    if (q.cashAccountIds.has(accountId)) continue;
    const entry = outside.get(accountId) ?? { count: 0, receive: Decimal.zero(), pay: Decimal.zero() };
    entry.count += Number(row.count);
    if (row.direction === 'receive') entry.receive = entry.receive.plus(row.amount as Decimal);
    else entry.pay = entry.pay.plus(row.amount as Decimal);
    outside.set(accountId, entry);
  }
  const accounts = await inChunks(
    [...outside.keys()],
    async (chunk) => (await repo(ctx, Account).list({ where: { id: { $in: chunk } }, limit: chunk.length })).items,
  );
  const names = new Map(accounts.map((a) => [a.id, a]));
  return {
    unallocated: { receive: advance('receive'), pay: advance('pay') },
    uncountedPaymentAccounts: [...outside.entries()]
      .map(([accountId, v]) => ({
        accountId,
        code: names.get(accountId)?.code ?? '',
        name: names.get(accountId)?.name ?? '',
        ...v,
      }))
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.accountId < b.accountId ? -1 : 1)),
  };
}

/** AC-8: the fixed notice when payroll is part of the forecast. */
export function noticesFor(included: ReadonlySet<CashSource>): CashNotice[] {
  return included.has('payroll') ? ['payroll_posted_overlap'] : [];
}
