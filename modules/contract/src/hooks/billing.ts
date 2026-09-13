// contract_billing guard (spec AC-4): the ledger is the idempotency record, so rows are written only by
// contract.generate_invoices (inside withBillingWrite). A generic contract_billing.create/update/delete — by any role,
// admin included — is refused, otherwise a period could be marked billed without an invoice run.
import { registry, StateError, type Context } from '@daifuku/kernel';
import { ContractBilling } from '../entities/contract-billing.ts';
import { isBillingWrite } from '../ledger.ts';

export const LEDGER_HINT =
  'contract_billing rows are written by contract.generate_invoices; run it for the period instead (delete a draft generated invoice to make its period due again).';

function guard(op: string) {
  return (ctx: Context): void => {
    if (isBillingWrite(ctx)) return;
    throw new StateError(`contract_billing cannot be written directly (${op})`, LEDGER_HINT, { op });
  };
}

export function registerBillingHooks(): void {
  registry.registerHook(ContractBilling.name, 'before_create', guard('create'));
  registry.registerHook(ContractBilling.name, 'before_update', guard('update'));
  registry.registerHook(ContractBilling.name, 'before_delete', guard('delete'));
}
