import { defineEntity, f, label } from '@daifuku/kernel';
import type { NormalizedPosEvent } from './contract.ts';
import { inboxStates } from './contract.ts';
const owned = { serverOwned: true },
  permissions = { roles: { accounting: ['read', 'create', 'update', 'export'] as const } };
export const PosLocation = defineEntity({
  name: 'pos_integration_location',
  label: label('POS連携店舗', 'POS integration location'),
  ext: false,
  fields: {
    code: f.text({
      label: label('店舗コード', 'Store code'),
      required: true,
      unique: true,
      immutable: true,
      maxLength: 40,
    }),
    name: f.text({ label: label('店舗名', 'Store name'), required: true, maxLength: 100 }),
    provider: f.enum(['square'], { required: true, default: 'square', immutable: true }),
    merchantId: f.text({
      label: label('Square加盟店ID', 'Square merchant ID'),
      required: true,
      maxLength: 100,
      immutable: true,
    }),
    externalLocationId: f.text({
      label: label('Square店舗ID', 'Square location ID'),
      required: true,
      maxLength: 100,
      immutable: true,
    }),
    mappingKey: f.text({ ...owned, required: true, unique: true, hidden: true, maxLength: 250 }),
    active: f.bool({ required: true, default: true, label: label('有効', 'Active') }),
    settlementAccountId: f.ref('account', {
      label: label('決済未収・現金勘定', 'Settlement asset account'),
      required: true,
    }),
    suspenseAccountId: f.ref('account', {
      label: label('売上未分類仮勘定', 'Unclassified proceeds liability'),
      required: true,
    }),
  },
  permissions,
  views: { list: ['code', 'name', 'merchantId', 'externalLocationId', 'active'] },
});
export const PosInbox = defineEntity({
  name: 'pos_integration_inbox',
  label: label('POS受信履歴', 'POS inbox'),
  ext: false,
  fields: {
    locationId: f.ref(PosLocation.name, { ...owned, required: true }),
    eventId: f.text({ ...owned, required: true, unique: true, maxLength: 200 }),
    kind: f.text({ ...owned, required: true, maxLength: 40 }),
    externalId: f.text({ ...owned, required: true, maxLength: 200 }),
    paymentId: f.text({ ...owned, maxLength: 200 }),
    event: f.json<NormalizedPosEvent>({ ...owned, required: true, hidden: true }),
    status: f.enum(inboxStates, { ...owned, required: true, default: 'received' }),
    attempts: f.int({ ...owned, required: true, default: 0 }),
    error: f.text({ ...owned, maxLength: 500 }),
    transactionId: f.ref('pos_integration_transaction', { ...owned }),
    receivedAt: f.timestamp({ ...owned, required: true }),
    lastAttemptAt: f.timestamp({ ...owned }),
  },
  permissions,
  indexes: [['status', 'paymentId']],
  views: { list: ['locationId', 'kind', 'externalId', 'status', 'attempts', 'error', 'transactionId'] },
});
export const PosTransaction = defineEntity({
  name: 'pos_integration_transaction',
  label: label('POS決済原資料', 'POS settlement source'),
  ext: false,
  fields: {
    locationId: f.ref(PosLocation.name, { ...owned, required: true }),
    key: f.text({ ...owned, required: true, unique: true, maxLength: 400 }),
    kind: f.enum(['payment', 'refund'], { ...owned, required: true }),
    externalId: f.text({ ...owned, required: true, maxLength: 200 }),
    paymentId: f.ref('pos_integration_transaction', { ...owned }),
    date: f.date({ ...owned, required: true }),
    amount: f.money({ ...owned, required: true, min: '1' }),
    currency: f.enum(['JPY'], { ...owned, required: true, default: 'JPY' }),
    refunded: f.money({ ...owned, required: true, default: '0' }),
    rawHash: f.text({ ...owned, required: true, maxLength: 64 }),
    settlementAccountId: f.ref('account', { ...owned, required: true }),
    suspenseAccountId: f.ref('account', { ...owned, required: true }),
    journalEntryId: f.ref('journal_entry', { ...owned }),
    status: f.enum(['posted', 'cancelled'], { ...owned, required: true, default: 'posted' }),
    cancelledDate: f.date({ ...owned }),
    cancelReason: f.text({ ...owned, maxLength: 500 }),
  },
  permissions,
  indexes: [['locationId', 'date']],
  views: { list: ['date', 'locationId', 'kind', 'externalId', 'amount', 'refunded', 'status', 'journalEntryId'] },
});
