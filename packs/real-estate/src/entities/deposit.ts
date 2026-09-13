// 敷金台帳 (spec AC-1). One row per lease deposit. The amount is money held for the tenant (返還する敷金 = 不課税, never
// invoiced): real_estate.receive_deposit posts Dr 預金 / Cr 預り金 and real_estate.return_deposit the reverse, and only
// those actions write the receipt/return fields (hooks/deposit.ts refuses them on any other path).
import { defineEntity, f, label } from '@daifuku/kernel';

export const DEPOSIT_SYSTEM_FIELDS = [
  'receivedDate',
  'returnedDate',
  'returnedAmount',
  'deductionAmount',
  'journalEntryId',
  'returnJournalEntryId',
] as const;

export const RealEstateDeposit = defineEntity({
  name: 'real_estate_deposit',
  label: label('敷金台帳', 'Security deposit'),
  fields: {
    contractId: f.ref('contract', {
      label: label('賃貸借契約', 'Lease'),
      required: true,
      immutable: true,
      index: true,
    }),
    partnerId: f.ref('partner', {
      immutable: true,
      label: label('入居者', 'Tenant'),
      description: label('省略時は契約の取引先', "defaults to the lease's partner"),
      required: true,
      index: true,
    }),
    unitId: f.ref('real_estate_unit', {
      immutable: true,
      label: label('部屋・区画', 'Unit'),
      description: label('省略時は契約の部屋', "defaults to the lease's unit"),
    }),
    amount: f.money({ label: label('敷金額', 'Deposit amount'), required: true, min: '0' }),
    receivedDate: f.date({ serverOwned: true, label: label('受領日', 'Received on') }),
    returnedDate: f.date({ serverOwned: true, label: label('返還日', 'Returned on') }),
    returnedAmount: f.money({
      serverOwned: true,
      label: label('返還額', 'Returned amount'),
      description: label('入居者に払い戻した額', 'paid back to the tenant'),
      required: true,
      default: '0',
    }),
    deductionAmount: f.money({
      serverOwned: true,
      label: label('控除額', 'Deducted amount'),
      description: label('原状回復費などに充てて返還しなかった額', 'kept (e.g. restoration costs)'),
      required: true,
      default: '0',
    }),
    journalEntryId: f.ref('journal_entry', { serverOwned: true, label: label('受領仕訳', 'Receipt entry') }),
    returnJournalEntryId: f.ref('journal_entry', { serverOwned: true, label: label('返還仕訳', 'Return entry') }),
  },
  permissions: {
    roles: {
      sales: ['read', 'create', 'update', 'delete'],
      accounting: ['read', 'update'],
      viewer: ['read'],
    },
  },
  views: {
    list: [
      'contractId',
      'partnerId',
      'unitId',
      'amount',
      'receivedDate',
      'returnedDate',
      'returnedAmount',
      'deductionAmount',
    ],
    form: [
      ['contractId', 'partnerId', 'unitId'],
      ['amount', 'receivedDate', 'journalEntryId'],
      ['returnedDate', 'returnedAmount', 'deductionAmount', 'returnJournalEntryId'],
    ],
  },
});
