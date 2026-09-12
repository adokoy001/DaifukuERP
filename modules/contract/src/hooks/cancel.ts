// contract before_cancel (spec AC-2): status 'cancelled'. Refused while an invoice generated from the contract is
// still live (draft or submitted): cancelling would leave billed invoices without their contract, and an amended
// copy (a new document with an empty ledger) would bill the same months again. Cancel or delete those invoices first.
import { DOCSTATUS, registry, StateError, type Context, type HookArgs } from '@daifuku/kernel';
import { Contract } from '../entities/contract.ts';
import { billingsOf } from '../ledger.ts';
import { invoicesById } from '../load.ts';

export const LIVE_INVOICES_HINT = 'Cancel the submitted invoices (or delete the drafts) generated from this contract first; to stop future billing use contract.end instead.';

async function beforeCancel(ctx: Context, { row }: HookArgs): Promise<void> {
  const id = row.id as string;
  const billings = await billingsOf(ctx, id);
  const invoices = await invoicesById(
    ctx,
    billings.map((b) => b.invoiceId),
  );
  const live = billings.filter((b) => invoices.get(b.invoiceId)?.docstatus !== DOCSTATUS.cancelled);
  if (live.length > 0) {
    throw new StateError(`contract ${String(row.number ?? id)} has ${live.length} live generated invoice(s) and cannot be cancelled`, LIVE_INVOICES_HINT, {
      invoices: live.map((b) => ({ period: b.period, invoiceId: b.invoiceId, number: invoices.get(b.invoiceId)?.number ?? null })),
    });
  }
  row.status = 'cancelled';
}

export function registerCancelHook(): void {
  registry.registerHook(Contract.name, 'before_cancel', beforeCancel);
}
