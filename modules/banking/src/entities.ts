import { defineEntity, f, label } from '@daifuku/kernel';
import type { BankTransferSnapshot } from './contract.ts';
const owned = { serverOwned: true } as const;
const hidden = { ...owned, outputHidden: true } as const;
const permissions = { roles: { accounting: ['read', 'create', 'update'] as const } };
const text = (maxLength: number) => f.text({ ...owned, maxLength, required: true });
const optionalText = (maxLength: number) => f.text({ ...owned, maxLength });
const identity = {
  bankCode: text(4), branchCode: text(3), accountType: f.enum(['ordinary', 'current'], { ...owned, required: true }),
  accountNumber: f.text({ ...hidden, required: true, maxLength: 7 }), holderKana: text(30), active: f.bool({ ...owned, required: true }),
};
export const BankAccount = defineEntity({ name: 'bank_account', label: label('銀行口座', 'Bank account'), ext: false, fields: {
  code: f.text({ ...owned, required: true, maxLength: 30, immutable: true, unique: true }), name: text(100), ledgerAccountId: f.ref('account', { ...owned, required: true }), requesterCode: f.text({ ...hidden, maxLength: 10, required: true }), ...identity,
}, permissions, views: { list: ['code', 'name', 'bankCode', 'branchCode', 'active'] } });
export const BankPayee = defineEntity({ name: 'bank_payee', label: label('振込先', 'Bank payee'), ext: false, fields: {
  partnerId: f.ref('partner', { ...owned, required: true, unique: true }), ...identity,
}, permissions, views: { list: ['partnerId', 'bankCode', 'branchCode', 'holderKana', 'active'] } });
export const BankImport = defineEntity({ name: 'bank_import', label: label('銀行明細取込', 'Bank statement import'), ext: false, fields: {
  bankAccountId: f.ref('bank_account', { ...owned, required: true }), importKey: f.text({ ...owned, required: true, unique: true, maxLength: 64 }), contentHash: text(64), rowCount: f.int({ ...owned, required: true }), imported: f.int({ ...owned, required: true }), duplicates: f.int({ ...owned, required: true }),
}, permissions });
export const BankStatement = defineEntity({ name: 'bank_statement', label: label('銀行明細', 'Bank statement'), ext: false, fields: {
  bankAccountId: f.ref('bank_account', { ...owned, required: true }), importId: f.ref('bank_import', { ...owned, required: true }), identityKey: f.text({ ...owned, required: true, unique: true, maxLength: 64 }), contentHash: text(64), externalId: text(100), bookedOn: f.date({ ...owned, required: true }), direction: f.enum(['receive', 'pay'], { ...owned, required: true }), amount: f.money({ ...owned, required: true, min: '1' }), description: optionalText(500),
}, indexes: [['bankAccountId', 'bookedOn']], permissions, views: { list: ['bankAccountId', 'bookedOn', 'direction', 'amount', 'description'] } });
export const BankReconciliation = defineEntity({ name: 'bank_reconciliation', label: label('銀行照合履歴', 'Bank reconciliation history'), ext: false, fields: {
  requestId: f.text({ ...owned, required: true, unique: true, maxLength: 36 }), requestHash: f.text({ ...owned, required: true, maxLength: 64 }), statementId: f.ref('bank_statement', { ...owned, required: true }), paymentId: f.ref('payment', { ...owned, required: true }), createdPayment: f.bool({ ...owned, required: true }), state: f.enum(['active', 'reversed'], { ...owned, required: true }), reason: text(500), reversedOn: f.date({ ...owned }), reversalReason: optionalText(500),
}, indexes: [['statementId', 'state'], ['paymentId', 'state']], permissions });
export const BankTransfer = defineEntity({ name: 'bank_transfer', label: label('銀行支払ファイル', 'Bank transfer file'), ext: false, fields: {
  requestId: f.text({ ...owned, required: true, unique: true, maxLength: 36 }), requestHash: f.text({ ...owned, required: true, maxLength: 64 }), bankAccountId: f.ref('bank_account', { ...owned, required: true }), accountVersion: f.int({ ...owned, required: true }), transferDate: f.date({ ...owned, required: true }), state: f.enum(['prepared', 'exported', 'cancelled'], { ...owned, required: true }), itemCount: f.int({ ...owned, required: true }), total: f.money({ ...owned, required: true }), snapshot: f.json<BankTransferSnapshot>({ ...hidden, required: true }), format: f.enum(['canonical_csv', 'zengin120'], owned), lineEnding: f.enum(['none', 'crlf'], owned), contentHash: optionalText(64), exportBytes: f.json<number[]>({ ...hidden }), cancelReason: optionalText(500),
}, permissions, views: { list: ['transferDate', 'state', 'itemCount', 'total'] } });
export const BankTransferReservation = defineEntity({ name: 'bank_transfer_reservation', label: label('支払ファイル請求関連', 'Transfer invoice reservation'), ext: false, fields: {
  batchId: f.ref('bank_transfer', { ...owned, required: true }), invoiceId: f.ref('purchase_invoice', { ...owned, required: true }), active: f.bool({ ...owned, required: true }),
}, indexes: [['invoiceId', 'active']], permissions });
export const bankingEntities = [BankAccount, BankPayee, BankImport, BankStatement, BankReconciliation, BankTransfer, BankTransferReservation] as const;
