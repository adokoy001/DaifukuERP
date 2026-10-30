// 精算明細 (spec AC-4/AC-5): one approved workforce expense (or a part of one) with its account, tax category and the
// document kept for it. The expense's date and description are copied (server-owned, D27); tax amounts are computed per
// expense x rate by hooks/recalc.ts (D7). `delete` is granted because the kernel's replace-all line save removes rows.
import { defineEntity, f, label } from '@daifuku/kernel';
import { TAX_CATEGORIES } from '@daifuku/mod-tax';
import { BOOKS_ONLY_REASONS, INVOICE_KINDS } from '../contract.ts';

const owned = { serverOwned: true } as const;

export const INVOICE_KIND_LABELS = {
  qualified: label('適格請求書等あり', 'Qualified invoice'),
  not_qualified: label('区分記載請求書等あり（経過措置）', 'Non-qualified invoice (transitional)'),
  books_only: label('帳簿のみ保存の特例', 'Books only (special rule)'),
  small_amount: label('少額特例', 'Small-amount relief'),
  none: label('書類なし（控除しない）', 'No document (no credit)'),
} as const;
export const BOOKS_ONLY_REASON_LABELS = {
  public_transport: label('公共交通機関（3万円未満）', 'Public transport (under ¥30,000)'),
  business_travel: label('出張旅費等', 'Business travel allowance'),
  vending_machine: label('自動販売機・自動サービス機（3万円未満）', 'Vending machine (under ¥30,000)'),
  collected_ticket: label('回収される入場券等', 'Ticket collected on use'),
} as const;

export const ExpenseSettlementLine = defineEntity({
  name: 'expense_settlement_line',
  label: label('精算明細', 'Expense settlement line'),
  import: false,
  siteAccess: { kind: 'parent', field: 'settlementId', entity: 'expense_settlement' },
  fields: {
    settlementId: f.ref('expense_settlement', {
      required: true,
      onDelete: 'cascade',
      label: label('精算書', 'Settlement'),
    }),
    seq: f.int({ required: true, default: 1, min: 1, label: label('行番号', 'Seq') }),
    expenseId: f.ref('workforce_expense', { required: true, index: true, label: label('経費', 'Expense') }),
    userId: f.uuid({ ...owned, required: true, hidden: true, label: label('従業員の利用者ID', 'Employee user ID') }),
    expenseDate: f.date({ ...owned, label: label('利用日', 'Expense date') }),
    description: f.text({ ...owned, maxLength: 1000, label: label('内容', 'Description') }),
    payeeName: f.text({
      maxLength: 200,
      label: label('支払先名', 'Payee name'),
      description: label('領収書の発行者（帳簿の相手方）', 'Issuer of the receipt'),
    }),
    accountId: f.ref('account', { required: true, label: label('勘定科目', 'Account') }),
    taxCategory: f.enum(TAX_CATEGORIES, {
      required: true,
      default: 'standard',
      label: label('税区分', 'Tax category'),
    }),
    amount: f.money({ required: true, label: label('金額（税込）', 'Amount (tax incl.)') }),
    invoiceKind: f.enum(INVOICE_KINDS, { label: label('請求書区分', 'Invoice kind'), labels: INVOICE_KIND_LABELS }),
    booksOnlyReason: f.enum(BOOKS_ONLY_REASONS, {
      label: label('帳簿のみの理由', 'Books-only reason'),
      labels: BOOKS_ONLY_REASON_LABELS,
    }),
    invoiceRegistrationNo: f.text({
      maxLength: 14,
      pattern: /^T\d{13}$/,
      normalize: 'upper',
      label: label('登録番号', 'Registration number'),
    }),
    taxRate: f.decimal({ ...owned, label: label('税率', 'Tax rate') }),
    taxableAmount: f.money({ ...owned, label: label('税抜額', 'Taxable amount') }),
    taxAmount: f.money({ ...owned, label: label('税額', 'Tax') }),
    deductibleTax: f.money({ ...owned, label: label('控除対象税額', 'Deductible tax') }),
    nonDeductibleTax: f.money({ ...owned, label: label('控除対象外税額', 'Non-deductible tax') }),
    creditRatio: f.decimal({ ...owned, label: label('控除率', 'Credit ratio') }),
  },
  indexes: [['settlementId', 'seq']],
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update', 'delete', 'export'],
      workforce_payroll: ['read', 'export'],
      workforce_hr: ['read', 'export'],
      workforce_manager: ['read'],
      workforce_employee: ['read'],
    },
    rowRules: [{ roles: ['workforce_employee'], where: { userId: '$ctx.userId' } }],
  },
  views: {
    list: [
      'seq',
      'expenseId',
      'expenseDate',
      'description',
      'payeeName',
      'accountId',
      'taxCategory',
      'amount',
      'invoiceKind',
      'booksOnlyReason',
      'invoiceRegistrationNo',
      'taxAmount',
      'deductibleTax',
    ],
  },
});
