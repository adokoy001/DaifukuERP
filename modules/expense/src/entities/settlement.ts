// 経費精算書 (docs/specs/expense-settlement.md AC-3..AC-12). One document per employee, site and kind; its lines are the
// approved workforce expenses it settles. Submit posts the expense entry through accounting `postFromSource` and creates
// the payout/refund through payment `createClearingPayment` (ADR-0039), in the same transaction.
//
// Roles (D8, AC-15/16): `accounting` is granted every operation, and the hooks additionally require `workforce_payroll`
// (or admin) because submit also settles the workforce expenses. HR/payroll read, site managers read their sites
// (siteAccess), an employee reads only their own (rowRule userId). Computed amounts are server-owned (hooks/recalc.ts).
import { defineDocument, f, label } from '@daifuku/kernel';
import { PAYMENT_METHODS } from '@daifuku/mod-payment';
import { EXPENSE_SETTLEMENT_KINDS } from '../contract.ts';

const owned = { serverOwned: true } as const;
const amount = (ja: string, en: string) => f.money({ ...owned, required: true, default: '0', label: label(ja, en) });

export const KIND_LABELS = {
  reimbursement: label('立替精算', 'Reimbursement'),
  corporate_card: label('法人カード精算', 'Corporate card'),
  advance: label('仮払精算', 'Advance clearing'),
} as const;

export const ExpenseSettlement = defineDocument({
  name: 'expense_settlement',
  label: label('経費精算書', 'Expense settlement'),
  naming: { type: 'sequence', prefix: 'EXP-', period: 'year' },
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
    kind: f.enum(EXPENSE_SETTLEMENT_KINDS, {
      required: true,
      immutable: true,
      label: label('種類', 'Kind'),
      labels: KIND_LABELS,
    }),
    date: f.date({ required: true, index: true, label: label('精算日', 'Settlement date') }),
    partnerId: f.ref('partner', {
      label: label('支払先（取引先）', 'Payee (partner)'),
      description: label(
        '従業員用の取引先。法人カード精算ではカード会社',
        "The employee's partner; the card company for a corporate-card settlement",
      ),
    }),
    advanceId: f.ref('expense_advance', { label: label('仮払', 'Advance') }),
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
    subtotal: amount('税抜合計', 'Subtotal'),
    taxTotal: amount('消費税額', 'Tax'),
    deductibleTax: amount('控除対象税額', 'Deductible tax'),
    nonDeductibleTax: amount('控除対象外税額', 'Non-deductible tax'),
    total: amount('合計（税込）', 'Total'),
    advanceAmount: amount('仮払額', 'Advance amount'),
    payAmount: amount('支払額', 'Amount paid out'),
    refundAmount: amount('返金額', 'Amount refunded'),
    taxSummary: f.json({ ...owned, label: label('税率別集計', 'Tax summary'), hidden: true }),
    journalEntryId: f.ref('journal_entry', { ...owned, label: label('仕訳', 'Journal entry') }),
    paymentId: f.ref('payment', { ...owned, label: label('入出金', 'Payment') }),
    note: f.text({ multiline: true, maxLength: 2000, label: label('備考', 'Note') }),
  },
  allowOnSubmit: ['journalEntryId', 'paymentId'],
  lines: [{ entity: 'expense_settlement_line', parentField: 'settlementId' }],
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
    list: ['employeeId', 'kind', 'date', 'total', 'payAmount', 'refundAmount', 'partnerId'],
    search: ['note'],
    form: [
      { label: label('基本', 'Basics'), fields: ['employeeId', 'kind', 'date', 'siteId'] },
      { label: label('支払', 'Payment'), fields: ['partnerId', 'advanceId', 'method', 'paymentAccountId'] },
      {
        label: label('金額', 'Amounts'),
        fields: [
          'subtotal',
          'taxTotal',
          'deductibleTax',
          'nonDeductibleTax',
          'total',
          'advanceAmount',
          'payAmount',
          'refundAmount',
        ],
      },
      { label: label('転記', 'Posting'), fields: ['journalEntryId', 'paymentId'] },
      { label: label('備考', 'Note'), fields: ['note'] },
    ],
  },
});
