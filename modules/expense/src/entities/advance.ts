// 仮払 (spec AC-13, D10): an amount paid to an employee before the expense happens, recorded by accounting when paid.
// Submit creates and submits the payout through payment `createClearingPayment` (Dr 仮払金 / Cr cash/bank, posted by
// payment). An advance settlement clears it in full (status open → settled); cancelling that settlement reopens it.
// No journalEntryId: the payment carries the posting. Same roles as the settlement (D8).
import { defineDocument, f, label } from '@daifuku/kernel';
import { PAYMENT_METHODS } from '@daifuku/mod-payment';
import { ADVANCE_STATUSES } from '../contract.ts';

const owned = { serverOwned: true } as const;

export const ExpenseAdvance = defineDocument({
  name: 'expense_advance',
  label: label('仮払', 'Expense advance'),
  naming: { type: 'sequence', prefix: 'ADV-', period: 'year' },
  import: false,
  siteAccess: { kind: 'store', field: 'siteId' },
  fields: {
    employeeId: f.ref('workforce_employee', {
      required: true,
      immutable: true,
      index: true,
      label: label('従業員', 'Employee'),
    }),
    userId: f.uuid({ ...owned, required: true, label: label('従業員の利用者ID', 'Employee user ID'), hidden: true }),
    siteId: f.ref('workforce_site', { ...owned, required: true, label: label('拠点', 'Site') }),
    partnerId: f.ref('partner', {
      required: true,
      label: label('支払先（取引先）', 'Payee (partner)'),
      description: label('従業員用の取引先', "The employee's partner"),
    }),
    date: f.date({ required: true, index: true, label: label('支払日', 'Payment date') }),
    amount: f.money({ required: true, label: label('金額', 'Amount') }),
    purpose: f.text({ required: true, maxLength: 500, label: label('目的', 'Purpose') }),
    method: f.enum(PAYMENT_METHODS, {
      required: true,
      default: 'bank_transfer',
      label: label('支払方法', 'Payment method'),
      labels: {
        cash: label('現金', 'Cash'),
        bank_transfer: label('振込', 'Bank transfer'),
        other: label('その他', 'Other'),
      },
    }),
    paymentAccountId: f.ref('account', {
      label: label('入出金口座', 'Cash / bank account'),
      description: label('省略時は設定 payment.accounts の方法別の既定', 'Defaults from payment.accounts by method'),
    }),
    status: f.enum(ADVANCE_STATUSES, {
      ...owned,
      label: label('精算状況', 'Settlement status'),
      labels: {
        open: label('未精算', 'Open'),
        settled: label('精算済み', 'Settled'),
        cancelled: label('取消', 'Cancelled'),
      },
    }),
    paymentId: f.ref('payment', { ...owned, label: label('入出金', 'Payment') }),
    note: f.text({ multiline: true, maxLength: 2000, label: label('備考', 'Note') }),
  },
  allowOnSubmit: ['paymentId', 'status'],
  indexes: [['employeeId', 'date']],
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend', 'export'],
      workforce_payroll: ['read', 'export'],
      workforce_hr: ['read', 'export'],
      workforce_manager: ['read'],
      workforce_employee: ['read'],
    },
    rowRules: [{ roles: ['workforce_employee'], where: { userId: '$ctx.userId' } }],
  },
  views: {
    list: ['employeeId', 'date', 'amount', 'purpose', 'status', 'partnerId'],
    search: ['purpose', 'note'],
    form: [
      { label: label('基本', 'Basics'), fields: ['employeeId', 'date', 'purpose', 'siteId'] },
      { label: label('支払', 'Payment'), fields: ['partnerId', 'method', 'paymentAccountId'] },
      { label: label('金額', 'Amounts'), fields: ['amount', 'status'] },
      { label: label('転記', 'Posting'), fields: ['paymentId'] },
      { label: label('備考', 'Note'), fields: ['note'] },
    ],
  },
});
