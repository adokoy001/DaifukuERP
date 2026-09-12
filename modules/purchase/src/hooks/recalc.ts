// purchase_invoice before_validate (docs/specs/purchase.md AC-1/AC-2): the single place a draft's derived header fields are
// computed. Runs on every create/update of a draft (the generic <entity>.update included) and is re-run after line
// changes, because the generic update saves the header BEFORE its lines: the header pass sees the old lines, and the
// re-save makes the last write reflect the final line set. The re-save happens once per kernel saveLines call through
// `after_lines_saved` (kernel-phase15 AC-7), and once per direct line write through hooks/lines.ts.
// Submitted/cancelled bills are left alone (only allowOnSubmit fields move after submit).
import { DOCSTATUS, Decimal, ValidationError, isLocalDate, registry, repo, todayLocal, type Context, type HookArgs, type Infer, type LocalDate } from '@daifuku/kernel';
import { Partner, computeDueDate } from '@daifuku/mod-partner';
import { taxSummaryFor, type TaxCategory } from '@daifuku/mod-tax';
import { PurchaseInvoice } from '../entities/purchase-invoice.ts';
import { PurchaseInvoiceLine } from '../entities/purchase-invoice-line.ts';
import { PURCHASE_CREDIT_RATIO_POINT, assertCreditRatio, defaultCreditRatio, type CreditRatioInput, type SupplierTaxStatus } from '../services/credit-ratio.ts';
import { applyCreditRatio, calculationToJson, type PurchaseCalculation } from '../services/recalculate.ts';

type Raw = Record<string, unknown>;
export type InvoiceLineRow = Infer<typeof PurchaseInvoiceLine>;
export type PartnerRow = Infer<typeof Partner>;

export interface InvoiceHead {
  partnerId: string;
  date: LocalDate;
  priceIncludesTax: boolean;
}

export interface InvoiceComputation {
  partner: PartnerRow;
  supplierTaxStatus: SupplierTaxStatus;
  creditRatio: Decimal;
  calc: PurchaseCalculation;
  /** Header field values to write: supplierTaxStatus, creditRatio, subtotal, taxTotal, deductibleTax, nonDeductibleTax, total, taxSummary. */
  fields: Raw;
}

export async function loadInvoiceLines(ctx: Context, invoiceId: string): Promise<InvoiceLineRow[]> {
  return (await repo(ctx, PurchaseInvoiceLine).list({ where: { invoiceId }, orderBy: [{ field: 'seq', dir: 'asc' }], limit: 500 })).items;
}

export async function loadSupplier(ctx: Context, partnerId: string): Promise<PartnerRow> {
  const partner = await repo(ctx, Partner).find(partnerId);
  if (!partner) throw new ValidationError(`partner ${partnerId} does not exist`, [{ path: 'partnerId', message: 'partner not found' }], 'Pass the id of an existing partner (see partner.list).');
  return partner;
}

/** AC-2: the credit ratio through the override point (l10n/jp registers the 経過措置 table under the same name). */
export function resolveCreditRatio(input: CreditRatioInput): Decimal {
  const fn = registry.override(PURCHASE_CREDIT_RATIO_POINT, defaultCreditRatio);
  return assertCreditRatio(fn(input), input);
}

/** Tax summary (one rounding per rate, modules/tax) → credit split → header totals, for the given lines. */
export async function computeInvoice(ctx: Context, head: InvoiceHead, lines: readonly Pick<InvoiceLineRow, 'amount' | 'taxCategory'>[], partner?: PartnerRow): Promise<InvoiceComputation> {
  const supplier = partner ?? (await loadSupplier(ctx, head.partnerId));
  const supplierTaxStatus = supplier.taxStatus;
  const creditRatio = resolveCreditRatio({ supplierTaxStatus, date: head.date });
  const summary = await taxSummaryFor(ctx, { date: head.date, priceIncludesTax: head.priceIncludesTax, lines: lines.map((l) => ({ amount: l.amount, category: l.taxCategory as TaxCategory })) });
  const calc = applyCreditRatio(summary, creditRatio);
  const { subtotal, taxTotal, deductibleTax, nonDeductibleTax, total } = calc.totals;
  return {
    partner: supplier,
    supplierTaxStatus,
    creditRatio,
    calc,
    fields: { supplierTaxStatus, creditRatio, subtotal, taxTotal, deductibleTax, nonDeductibleTax, total, taxSummary: calculationToJson(calc) },
  };
}

/** Value of a header field as the merged draft would have it (patch wins over the stored row). */
function merged(draft: Raw, previous: Raw | undefined, key: string): unknown {
  return draft[key] !== undefined ? draft[key] : previous?.[key];
}

/**
 * dueDate: computed from the supplier's terms when the bill has none, when the patch sets it to null, or when the patch
 * changes date/partner without giving a due date. An explicit due date in the patch is kept as is.
 */
function needsDueDate(draft: Raw, previous: Raw | undefined): boolean {
  if ('dueDate' in draft) return draft.dueDate === null || draft.dueDate === undefined;
  if (!previous || previous.dueDate === null || previous.dueDate === undefined) return true;
  return (draft.date !== undefined && draft.date !== previous.date) || (draft.partnerId !== undefined && draft.partnerId !== previous.partnerId);
}

async function onInvoiceValidate(ctx: Context, { row: draft, previous }: HookArgs): Promise<void> {
  if (previous && previous.docstatus !== DOCSTATUS.draft) return;
  const partnerId = merged(draft, previous, 'partnerId');
  // Business "today" is JST (todayLocal), not the kernel's UTC default, so the ratio and the stored date agree.
  const date = merged(draft, previous, 'date') ?? todayLocal(ctx.now());
  if (typeof partnerId !== 'string' || typeof date !== 'string' || !isLocalDate(date)) return; // zod reports the shape error
  if (!previous && draft.date === undefined) draft.date = date;
  const includes = merged(draft, previous, 'priceIncludesTax');
  const head: InvoiceHead = { partnerId, date, priceIncludesTax: typeof includes === 'boolean' ? includes : true };
  const partner = await loadSupplier(ctx, partnerId);
  const lines = previous ? await loadInvoiceLines(ctx, previous.id as string) : [];
  const computed = await computeInvoice(ctx, head, lines, partner);
  Object.assign(draft, computed.fields);
  if (needsDueDate(draft, previous)) draft.dueDate = computeDueDate(date, partner.closingDay, partner.paymentMonthOffset, partner.paymentDay);
  // System-owned while draft: these only move through submit / applyPayment / cancel.
  draft.status = 'draft';
  draft.paidAmount = Decimal.zero();
  draft.balance = computed.calc.totals.total;
  draft.journalEntryId = null;
  draft.cancelledDate = null;
  draft.controlAccountId = null;
  draft.settlementHistory = false;
}

/** Re-saves the header so before_validate recomputes it from the current lines (called by the line hooks). */
export async function recalculateInvoice(ctx: Context, invoiceId: string): Promise<void> {
  const r = repo(ctx, PurchaseInvoice);
  const head = await r.find(invoiceId);
  if (!head || head.docstatus !== DOCSTATUS.draft) return;
  await r.update(invoiceId, {});
}

export function registerRecalcHooks(): void {
  registry.registerHook(PurchaseInvoice.name, 'before_validate', onInvoiceValidate);
  // one header re-save per saveLines call (the kernel passes the re-read parent), whatever the line count
  registry.registerHook(PurchaseInvoice.name, 'after_lines_saved', (ctx, { row }) => recalculateInvoice(ctx, row.id as string));
}
