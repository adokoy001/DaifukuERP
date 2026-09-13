// payment submit hooks (spec AC-2, AC-3). before_submit, in the submitting user's context and transaction:
//   1. the roles must cover the direction (AC-6) and amount must be > 0;
//   2. every allocation is re-validated against a fresh snapshot of its invoice (AC-2: submitted + open, same partner
//      and direction, amount <= balance, one line per invoice, Σ <= amount) — the draft-time checks cannot see Σ;
//   3. the allocations are applied through sales/purchase `applyPayment` (paidAmount/balance/status move);
//   4. the cash entry is posted through accounting `postFromSource`;
//   5. allocatedAmount / unallocatedAmount / journalEntryId are set on the row the kernel writes with docstatus/number.
// A failure anywhere leaves the payment a draft and the invoices untouched (same transaction).
// after_submit: the entry's description gets the payment number, which does not exist before numbering.
import {
  registry,
  repo,
  ValidationError,
  StateError,
  type Context,
  type HookArgs,
  type LocalDate,
} from '@daifuku/kernel';
import { JournalEntry, postFromSource, assertJpySettlement, postingDimensions } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { PaymentAllocation } from '../entities/payment-allocation.ts';
import { Payment, type PaymentDirection } from '../entities/payment.ts';
import { applyInvoicePayment, loadInvoices } from '../invoices.ts';
import {
  invoiceEntityFor,
  tryDecimal,
  validateAllocations,
  type AllocationLine,
  type InvoiceSnapshot,
} from '../services/allocate.ts';
import { entryDescription, journalLinesFor } from '../services/posting.ts';
import { resolvePostingAccounts } from '../settings.ts';
import { assertDirectionRole } from './validate.ts';

export const ALLOCATION_HINT =
  'Fix the allocations (see details.issues; payment.outstanding lists what can be allocated) and submit again.';

export async function loadAllocationLines(ctx: Context, paymentId: string): Promise<AllocationLine[]> {
  const res = await repo(ctx, PaymentAllocation).list({
    where: { paymentId },
    orderBy: [{ field: 'seq', dir: 'asc' }],
    limit: 500,
  });
  return res.items.map((l) => ({
    seq: l.seq,
    invoiceEntity: l.invoiceEntity,
    invoiceId: l.invoiceId,
    amount: l.amount,
  }));
}

interface Head {
  id: string;
  direction: PaymentDirection;
  partnerId: string;
  date: LocalDate;
  accountId: string;
}

function headOf(row: Record<string, unknown>): Head {
  const id = row.id as string;
  if (typeof row.partnerId !== 'string')
    throw new ValidationError(
      `payment ${id} has no partner`,
      [{ path: 'partnerId', message: 'required' }],
      'Set partnerId, then submit.',
    );
  if (typeof row.accountId !== 'string')
    throw new ValidationError(
      `payment ${id} has no cash/bank account`,
      [{ path: 'accountId', message: 'required' }],
      'Set accountId, then submit.',
    );
  return {
    id,
    direction: row.direction as PaymentDirection,
    partnerId: row.partnerId,
    date: row.date as LocalDate,
    accountId: row.accountId,
  };
}

async function beforeSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  assertDirectionRole(ctx, row.direction, 'submit');
  const head = headOf(row);
  const amount = tryDecimal(row.amount);
  if (!amount || !amount.gt(0))
    throw new ValidationError(
      `payment ${head.id} amount must be greater than 0`,
      [{ path: 'amount', message: 'must be > 0' }],
      'Set a positive amount, then submit.',
    );
  await assertJpySettlement(ctx, amount, 'amount');
  const lines = await loadAllocationLines(ctx, head.id);
  const entity = invoiceEntityFor(head.direction);
  const invoices: Map<string, InvoiceSnapshot> =
    lines.length > 0
      ? await loadInvoices(
          ctx,
          entity,
          lines.filter((l) => l.invoiceEntity === entity).map((l) => l.invoiceId),
          true,
        )
      : new Map();
  const result = validateAllocations({ direction: head.direction, partnerId: head.partnerId, amount, lines, invoices });
  if (result.issues.length > 0)
    throw new ValidationError(`payment ${head.id} cannot be submitted`, result.issues, ALLOCATION_HINT);
  for (const l of lines)
    if (!invoices.get(l.invoiceId)?.controlAccountId)
      throw new StateError(
        'Invoice control account snapshot is missing',
        'Migrate the invoice posting account before allocating payment.',
      );
  for (const l of lines)
    await applyInvoicePayment(ctx, {
      entity: l.invoiceEntity,
      invoiceId: l.invoiceId,
      amount: l.amount,
      date: head.date,
    });
  const accounts = await resolvePostingAccounts(ctx);
  const partner = await repo(ctx, Partner).get(head.partnerId);
  const journalLines = journalLinesFor({
    direction: head.direction,
    partnerId: head.partnerId,
    accountId: head.accountId,
    amount,
    allocations: lines.map((l) => ({
      invoiceNumber: invoices.get(l.invoiceId)?.number ?? null,
      controlAccountId: invoices.get(l.invoiceId)?.controlAccountId ?? null,
      amount: l.amount,
    })),
    unallocated: result.unallocated,
    accounts,
  });
  const entry = await postFromSource(ctx, {
    sourceEntity: Payment.name,
    sourceId: head.id,
    date: head.date,
    description: entryDescription(head.direction, partner.name, null),
    ext: row.ext as Record<string, unknown>,
    lines: journalLines.map((l) => ({
      ...l,
      ext: postingDimensions(Payment.name, 'journal_line', row.ext as Record<string, unknown>),
    })),
  });
  Object.assign(row, {
    allocatedAmount: result.allocated,
    unallocatedAmount: result.unallocated,
    journalEntryId: entry.id,
  });
}

async function afterSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  if (typeof row.journalEntryId !== 'string' || typeof row.number !== 'string' || typeof row.partnerId !== 'string')
    return;
  const partner = await repo(ctx, Partner).get(row.partnerId);
  await repo(ctx, JournalEntry).update(row.journalEntryId, {
    description: entryDescription(row.direction as PaymentDirection, partner.name, row.number),
  });
}

export function registerSubmitHooks(): void {
  registry.registerHook(Payment.name, 'before_submit', beforeSubmit);
  registry.registerHook(Payment.name, 'after_submit', afterSubmit);
}
