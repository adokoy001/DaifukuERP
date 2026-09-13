// sales_invoice header hooks (spec AC-1/AC-2).
// before_validate: on create the computed fields are system-owned (zeroed whatever the caller sent — this also
//   resets a copy made by amend), priceIncludesTax defaults to the company's tax setting, `date` to today (JST) and
//   dueDate is computed from the partner's terms when empty. On update, dueDate is recomputed only when the patch
//   leaves it empty (explicit null) — a value once set is the user's.
// before_update (drafts only): totals/taxSummary/balance are always re-derived from the lines, so a date or
//   priceIncludesTax change, a line write (hooks/lines.ts touches the header) and a tampered patch all end in the
//   same derived state. Submitted invoices skip this (lines are frozen; applyPayment writes paidAmount/balance/status).
// after_lines_saved (kernel-phase15 AC-7): a replace-all line save touches the header once, whatever the line count.
import {
  Decimal,
  DOCSTATUS,
  getSetting,
  isLocalDate,
  isUuid,
  registry,
  repo,
  todayLocal,
  type Context,
  type HookArgs,
  type LocalDate,
} from '@daifuku/kernel';
import { computeDueDate, Partner } from '@daifuku/mod-partner';
import {
  TAX_PRICE_INCLUDES_TAX_DEFAULT,
  TAX_PRICE_INCLUDES_TAX_KEY,
  taxPriceIncludesTaxSchema,
} from '@daifuku/mod-tax';
import { SalesInvoice } from '../entities/sales-invoice.ts';
import { recalculateInvoice } from '../recalculate.ts';
import { balanceOf } from '../services/recalculate.ts';

type Raw = Record<string, unknown>;

/** Fields the caller never controls on a draft. */
export const SYSTEM_OWNED_FIELDS = [
  'subtotal',
  'taxTotal',
  'total',
  'taxSummary',
  'paidAmount',
  'balance',
  'status',
  'journalEntryId',
] as const;

function resetSystemFields(row: Raw): void {
  Object.assign(row, {
    subtotal: '0',
    taxTotal: '0',
    total: '0',
    taxSummary: [],
    paidAmount: '0',
    balance: '0',
    status: 'draft',
    journalEntryId: null,
    issuedSnapshot: null,
    cancelledDate: null,
    controlAccountId: null,
    settlementHistory: false,
  });
}

async function fillDueDate(ctx: Context, row: Raw, previous: Raw | undefined): Promise<void> {
  const current = row.dueDate !== undefined ? row.dueDate : (previous?.dueDate ?? null);
  if (current !== null) return;
  const partnerId = row.partnerId ?? previous?.partnerId;
  const date = row.date ?? previous?.date;
  if (typeof partnerId !== 'string' || !isUuid(partnerId) || typeof date !== 'string' || !isLocalDate(date)) return;
  const partner = await repo(ctx, Partner).find(partnerId);
  if (!partner) return; // the FK / zod report the missing partner
  row.dueDate = computeDueDate(date, partner.closingDay, partner.paymentMonthOffset, partner.paymentDay);
}

async function beforeValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  if (!previous) {
    resetSystemFields(row);
    if (row.priceIncludesTax === undefined || row.priceIncludesTax === null) {
      row.priceIncludesTax = await getSetting(
        ctx,
        TAX_PRICE_INCLUDES_TAX_KEY,
        taxPriceIncludesTaxSchema,
        TAX_PRICE_INCLUDES_TAX_DEFAULT,
      );
    }
    if (row.date === undefined || row.date === null) row.date = todayLocal(ctx.now());
  }
  await fillDueDate(ctx, row, previous);
}

async function beforeUpdate(ctx: Context, { row }: HookArgs): Promise<void> {
  if (row.docstatus !== DOCSTATUS.draft) return;
  const { totals } = await recalculateInvoice(ctx, {
    id: row.id as string,
    date: row.date as LocalDate,
    priceIncludesTax: row.priceIncludesTax === true,
  });
  // a draft has no payments: paidAmount 0, balance = total
  Object.assign(row, {
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
    taxSummary: totals.taxSummary,
    paidAmount: Decimal.zero(),
    balance: balanceOf(totals.total, '0'),
    status: 'draft',
    journalEntryId: null,
  });
}

/** One header touch per saveLines call; before_update above does the recalculation. `row` is the parent, re-read by the kernel. */
async function afterLinesSaved(ctx: Context, { row }: HookArgs): Promise<void> {
  if (row.docstatus !== DOCSTATUS.draft) return;
  await repo(ctx, SalesInvoice).update(row.id as string, {});
}

export function registerRecalcHooks(): void {
  registry.registerHook(SalesInvoice.name, 'before_validate', beforeValidate);
  registry.registerHook(SalesInvoice.name, 'before_update', beforeUpdate);
  registry.registerHook(SalesInvoice.name, 'after_lines_saved', afterLinesSaved);
}
