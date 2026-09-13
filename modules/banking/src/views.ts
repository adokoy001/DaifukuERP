import type { Infer } from '@daifuku/kernel';
import type { BankAccount, BankPayee, BankReconciliation, BankStatement, BankTransfer } from './entities.ts';
export const maskedAccount = (value: string) => `****${value.slice(-3)}`;
export function identity(row: Infer<typeof BankAccount> | Infer<typeof BankPayee>) {
  return {
    bankCode: row.bankCode,
    branchCode: row.branchCode,
    accountType: row.accountType,
    accountNumber: row.accountNumber,
    holderKana: row.holderKana,
  };
}
export function accountView(row: Infer<typeof BankAccount>) {
  const { accountNumber, ...visible } = identity(row);
  return {
    ...visible,
    id: row.id,
    version: row.version,
    code: row.code,
    name: row.name,
    ledgerAccountId: row.ledgerAccountId,
    requesterCode: row.requesterCode,
    active: row.active,
    accountNumberMasked: maskedAccount(accountNumber),
  };
}
export function payeeView(row: Infer<typeof BankPayee>, partnerName: string) {
  const { accountNumber, ...visible } = identity(row);
  return {
    ...visible,
    id: row.id,
    version: row.version,
    partnerId: row.partnerId,
    partnerName,
    active: row.active,
    accountNumberMasked: maskedAccount(accountNumber),
  };
}
export function statementView(row: Infer<typeof BankStatement>, active?: Infer<typeof BankReconciliation>) {
  return {
    id: row.id,
    version: row.version,
    bankAccountId: row.bankAccountId,
    externalId: row.externalId,
    bookedOn: row.bookedOn,
    direction: row.direction,
    amount: row.amount.toString(),
    description: row.description ?? '',
    reconciliationId: active?.id ?? null,
    paymentId: active?.paymentId ?? null,
    state: active ? ('reconciled' as const) : ('unmatched' as const),
  };
}
export function reconciliationView(row: Infer<typeof BankReconciliation>) {
  return {
    id: row.id,
    version: row.version,
    statementId: row.statementId,
    paymentId: row.paymentId,
    createdPayment: row.createdPayment,
    state: row.state,
    reason: row.reason,
    reversedOn: row.reversedOn,
    reversalReason: row.reversalReason,
  };
}
export function transferView(row: Infer<typeof BankTransfer>) {
  return {
    id: row.id,
    version: row.version,
    bankAccountId: row.bankAccountId,
    transferDate: row.transferDate,
    state: row.state,
    itemCount: row.itemCount,
    total: row.total.toString(),
    format: row.format,
    lineEnding: row.lineEnding,
    cancelReason: row.cancelReason,
    contentHash: row.contentHash,
  };
}
