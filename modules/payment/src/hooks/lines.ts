// payment_allocation hooks (spec AC-2).
// before_validate: the per-line checks that do not depend on the other lines — amount > 0, invoiceEntity matches
//   the parent's direction, the invoice exists and is visible through the sales/purchase repository, is submitted and
//   open, belongs to the payment's partner, and amount <= its balance and <= the payment amount. Σ-checks (one
//   allocation per invoice, Σ <= amount) wait for submit because the replace-all line save creates before it deletes.
// before_create/update/delete: lines of a non-draft payment are frozen on every path (the kernel only guards the
//   replace-all saveLines path; direct repo writes are covered here, like sales/purchase).
// after_create/update/delete: for a DIRECT line write (repo / payment_allocation.* actions) the header is "touched" (an
//   empty update) so its before_update hook re-derives allocatedAmount / unallocatedAmount — one place computes, whichever
//   path wrote the line. Inside the kernel's replace-all saveLines (generic create/update with `lines`, amend) these are
//   no-ops: the payment's `after_lines_saved` hook (hooks/validate.ts) touches it once per save instead of once per line
//   (phase15-cleanup AC-4, the sales/purchase pattern of kernel-phase15 AC-7).
import { DOCSTATUS, isSavingLines, isUuid, registry, repo, StateError, ValidationError, type Context, type HookArgs, type Infer } from '@daifuku/kernel';
import { INVOICE_ENTITIES, PaymentAllocation, type InvoiceEntity } from '../entities/payment-allocation.ts';
import { Payment } from '../entities/payment.ts';
import { loadInvoice } from '../invoices.ts';
import { invoiceEntityFor, lineIssues, tryDecimal } from '../services/allocate.ts';

type Raw = Record<string, unknown>;
type PaymentRow = Infer<typeof Payment>;

export const FROZEN_HINT = 'Cancel and amend the payment to change its allocations (ADR-0006).';

function frozenError(parent: PaymentRow): StateError {
  return new StateError(`payment ${parent.number ?? parent.id} is not a draft; its allocations are frozen`, FROZEN_HINT, { paymentId: parent.id, docstatus: parent.docstatus });
}

async function loadParent(ctx: Context, paymentId: unknown): Promise<PaymentRow | null> {
  if (typeof paymentId !== 'string' || !isUuid(paymentId)) return null; // zod / FK report it
  return repo(ctx, Payment).find(paymentId);
}

async function assertParentDraft(ctx: Context, paymentId: unknown): Promise<void> {
  const parent = await loadParent(ctx, paymentId);
  if (parent && parent.docstatus !== DOCSTATUS.draft) throw frozenError(parent);
}

function isInvoiceEntity(v: unknown): v is InvoiceEntity {
  return typeof v === 'string' && (INVOICE_ENTITIES as readonly string[]).includes(v);
}

function merged(row: Raw, previous: Raw | undefined, key: string): unknown {
  return row[key] !== undefined ? row[key] : previous?.[key];
}

/** The line as it would be stored, checked against its parent and invoice; VALIDATION lists every failed rule. */
async function beforeValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  const invoiceEntity = merged(row, previous, 'invoiceEntity');
  const invoiceId = merged(row, previous, 'invoiceId');
  const amount = tryDecimal(merged(row, previous, 'amount'));
  if (!isInvoiceEntity(invoiceEntity) || typeof invoiceId !== 'string' || !isUuid(invoiceId) || !amount) return; // zod reports it
  const parent = await loadParent(ctx, merged(row, previous, 'paymentId'));
  if (!parent) return; // FK reports it
  if (parent.docstatus !== DOCSTATUS.draft) throw frozenError(parent);
  // a mismatched entity is reported as VALIDATION before any read the caller's roles might not be allowed to make
  const invoice = invoiceEntity === invoiceEntityFor(parent.direction) ? await loadInvoice(ctx, invoiceEntity, invoiceId) : null;
  const seq = typeof row.seq === 'number' ? row.seq : typeof previous?.seq === 'number' ? previous.seq : 0;
  const issues = lineIssues({ seq, invoiceEntity, invoiceId, amount }, { direction: parent.direction, partnerId: parent.partnerId, amount: parent.amount }, invoice, '');
  if (issues.length > 0) {
    throw new ValidationError(`payment_allocation: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`, issues, 'Allocate an open invoice of the same partner and direction, at most its balance (see payment.outstanding).');
  }
}

async function touchPayment(ctx: Context, paymentId: unknown): Promise<void> {
  if (typeof paymentId !== 'string') return;
  if (isSavingLines(ctx, Payment.name, paymentId)) return; // after_lines_saved touches once (hooks/validate.ts)
  await repo(ctx, Payment).update(paymentId, {});
}

export function registerLineHooks(): void {
  registry.registerHook(PaymentAllocation.name, 'before_validate', beforeValidate);
  registry.registerHook(PaymentAllocation.name, 'before_create', (ctx, { row }) => assertParentDraft(ctx, row.paymentId));
  registry.registerHook(PaymentAllocation.name, 'before_update', async (ctx, { row, previous }) => {
    await assertParentDraft(ctx, previous?.paymentId);
    if (row.paymentId !== previous?.paymentId) await assertParentDraft(ctx, row.paymentId);
  });
  registry.registerHook(PaymentAllocation.name, 'before_delete', (ctx, { row }) => assertParentDraft(ctx, row.paymentId));
  registry.registerHook(PaymentAllocation.name, 'after_create', (ctx, { row }) => touchPayment(ctx, row.paymentId));
  registry.registerHook(PaymentAllocation.name, 'after_update', async (ctx, { row, previous }) => {
    await touchPayment(ctx, row.paymentId);
    if (previous && previous.paymentId !== row.paymentId) await touchPayment(ctx, previous.paymentId);
  });
  registry.registerHook(PaymentAllocation.name, 'after_delete', (ctx, { row }) => touchPayment(ctx, row.paymentId));
}
