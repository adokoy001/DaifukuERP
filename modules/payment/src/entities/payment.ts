// Payment header (入金・支払, spec AC-1). `allocatedAmount` / `unallocatedAmount` / `journalEntryId` are system-owned:
// hooks/validate.ts derives them while the payment is a draft, hooks/submit.ts fixes them at submit (and posts),
// hooks/cancel.ts un-applies and reverses. Nothing changes after submit except journalEntryId (allowOnSubmit).
//
// Roles (AC-6): `accounting` does everything; `sales` handles receipts (direction receive), `purchasing`
// disbursements (direction pay) — rowRules hide the other direction from them and hooks/validate.ts refuses a
// create/update/submit whose direction the caller's roles do not cover; `viewer` reads. The submit hook calls
// sales/purchase `applyPayment` and accounting `postFromSource` in the submitting user's context (ADR-0007, no bypass):
// sales_invoice / purchase_invoice grant `update` to accounting and to their own role, journal_entry grants
// create/update/submit to sales, purchasing and accounting, so every role that may submit here can complete the cycle.
import { defineDocument, f, label } from '@daifuku/kernel';

export const PAYMENT_DIRECTIONS = ['receive', 'pay'] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const Payment = defineDocument({
  name: 'payment',
  label: label('入出金', 'Payment'),
  naming: { type: 'sequence', prefix: 'PAY-', period: 'year' },
  fields: {
    cancelledDate: f.date({
      label: label('取消有効日', 'Cancellation effective date'),
      serverOwned: true,
      hidden: true,
    }),
    currency: f.enum(['JPY'], { label: label('通貨', 'Currency'), required: true, default: 'JPY', immutable: true }),
    direction: f.enum(PAYMENT_DIRECTIONS, {
      label: label('区分', 'Direction'),
      required: true,
      index: true,
      labels: { receive: label('入金', 'Receipt'), pay: label('支払', 'Disbursement') },
    }),
    partnerId: f.ref('partner', { label: label('取引先', 'Partner'), required: true, index: true }),
    date: f.date({ label: label('日付', 'Date'), required: true, default: 'today', index: true }),
    amount: f.money({
      label: label('金額', 'Amount'),
      description: label('0 より大きい', 'must be > 0'),
      required: true,
    }),
    method: f.enum(PAYMENT_METHODS, {
      label: label('方法', 'Method'),
      required: true,
      default: 'bank_transfer',
      labels: {
        cash: label('現金', 'Cash'),
        bank_transfer: label('振込', 'Bank transfer'),
        other: label('その他', 'Other'),
      },
    }),
    accountId: f.ref('account', {
      label: label('入出金科目', 'Cash / bank account'),
      description: label(
        '現金または普通預金。省略時は設定 payment.accounts（cash なら現金、他は普通預金）',
        'Cash or bank account; defaults from payment.accounts by method',
      ),
      required: true,
    }),
    allocatedAmount: f.money({
      serverOwned: true,
      label: label('消込額', 'Allocated'),
      description: label('明細の合計（自動計算）', 'Σ allocation lines, computed'),
      required: true,
      default: '0',
    }),
    unallocatedAmount: f.money({
      serverOwned: true,
      label: label('未消込額', 'Unallocated'),
      description: label('金額 − 消込額（前受金／前払金）', 'amount − allocated (advance)'),
      required: true,
      default: '0',
    }),
    note: f.text({ label: label('備考', 'Note'), multiline: true, maxLength: 2000 }),
    journalEntryId: f.ref('journal_entry', {
      serverOwned: true,
      label: label('仕訳', 'Journal entry'),
      description: label('submit 時に転記', 'posted at submit'),
    }),
  },
  allowOnSubmit: ['journalEntryId'],
  lines: [{ entity: 'payment_allocation', parentField: 'paymentId' }],
  indexes: [['partnerId', 'date']],
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
      sales: ['read', 'create', 'update', 'submit'],
      purchasing: ['read', 'create', 'update', 'submit'],
      viewer: ['read'],
    },
    rowRules: [
      { roles: ['sales'], where: { direction: 'receive' } },
      { roles: ['purchasing'], where: { direction: 'pay' } },
    ],
  },
  views: {
    list: ['direction', 'partnerId', 'date', 'amount', 'allocatedAmount', 'unallocatedAmount', 'method'],
    search: ['note'],
    form: [
      ['direction', 'partnerId', 'date', 'method'],
      ['amount', 'accountId'],
      ['allocatedAmount', 'unallocatedAmount'],
      ['note', 'journalEntryId'],
    ],
  },
});

export type PaymentDef = typeof Payment;
