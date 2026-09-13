import { defineEntity, f, label } from '@daifuku/kernel';
import { TAX_CATEGORIES } from '@daifuku/mod-tax';
import type { FranchiseContractSnapshot } from './contract.ts';
const owned = { serverOwned: true };
export const FranchiseAgreement = defineEntity({
  name: 'franchise_agreement',
  label: label('FC精算契約', 'Franchise settlement agreement'),
  ext: false,
  fields: {
    code: f.text({ label: label('コード', 'Code'), required: true, unique: true, immutable: true, maxLength: 40 }),
    name: f.text({ label: label('名称', 'Name'), required: true, maxLength: 100 }),
    partnerId: f.ref('partner', { label: label('取引先', 'Partner'), required: true }),
    direction: f.enum(['bill', 'pay'], {
      labels: { bill: label('加盟店へ請求', 'Invoice franchisee'), pay: label('本部へ支払', 'Pay franchisor') },
      label: label('精算方向', 'Direction'),
      required: true,
    }),
    startDate: f.date({ label: label('開始日', 'Start date'), required: true }),
    endDate: f.date({ label: label('終了日', 'End date'), required: true }),
    basis: f.enum(['gross', 'net'], {
      labels: { gross: label('税込売上', 'Gross sales'), net: label('税抜売上', 'Net sales') },
      label: label('売上基準', 'Sales basis'),
      required: true,
    }),
    rate: f.decimal({
      label: label('料率（0.05＝5%）', 'Rate (0.05 = 5%)'),
      required: true,
      precision: 12,
      scale: 8,
      min: '0',
      max: '1',
    }),
    fixedAmount: f.money({ label: label('定額料（円）', 'Fixed fee (JPY)'), required: true, min: '0', default: '0' }),
    rounding: f.enum(['down', 'half_up', 'up'], {
      labels: {
        down: label('切り捨て', 'Round down'),
        half_up: label('四捨五入', 'Half up'),
        up: label('切り上げ', 'Round up'),
      },
      label: label('円未満の丸め', 'JPY rounding'),
      required: true,
    }),
    taxCategory: f.enum(TAX_CATEGORIES, { label: label('税区分', 'Tax category'), required: true }),
    expenseAccountId: f.ref('account', { label: label('費用科目', 'Expense account') }),
  },
  permissions: { roles: { accounting: ['read', 'create', 'update'], sales: ['read'], purchasing: ['read'] } },
  views: { list: ['code', 'name', 'direction', 'startDate', 'endDate', 'basis', 'rate'] },
});
export const FranchiseSettlement = defineEntity({
  name: 'franchise_settlement',
  label: label('FC月次精算', 'Monthly franchise settlement'),
  ext: false,
  fields: {
    agreementId: f.ref('franchise_agreement', {
      label: label('FC契約', 'Franchise agreement'),
      ...owned,
      required: true,
    }),
    month: f.text({ label: label('精算月', 'Settlement month'), ...owned, required: true, maxLength: 7 }),
    direction: f.enum(['bill', 'pay'], {
      labels: { bill: label('加盟店へ請求', 'Invoice franchisee'), pay: label('本部へ支払', 'Pay franchisor') },
      label: label('精算方向', 'Direction'),
      ...owned,
      required: true,
    }),
    status: f.enum(['invoiced', 'paid', 'cancelled'], { label: label('状態', 'Status'), ...owned, required: true }),
    grossSales: f.money({ label: label('税込売上', 'Gross sales'), ...owned, required: true }),
    netSales: f.money({ label: label('税抜売上', 'Net sales'), ...owned, required: true }),
    sourceReference: f.text({
      label: label('売上根拠資料', 'Sales evidence'),
      ...owned,
      required: true,
      maxLength: 1000,
    }),
    contract: f.json<FranchiseContractSnapshot>({ ...owned, required: true }),
    fee: f.money({ label: label('精算料（税抜）', 'Fee before tax'), ...owned, required: true }),
    total: f.money({ label: label('税込請求額', 'Invoice total'), ...owned, required: true }),
    tax: f.money({ label: label('消費税', 'Tax'), ...owned, required: true }),
    date: f.date({ label: label('日付', 'Date'), ...owned, required: true }),
    dueDate: f.date({ label: label('支払期日', 'Due date'), ...owned, required: true }),
    salesInvoiceId: f.ref('sales_invoice', { ...owned, label: label('売上請求書', 'Sales invoice') }),
    purchaseInvoiceId: f.ref('purchase_invoice', { ...owned, label: label('仕入請求書', 'Purchase invoice') }),
    paymentId: f.ref('payment', { ...owned, label: label('入出金', 'Payment') }),
    cancelledDate: f.date({ ...owned, label: label('取消有効日', 'Cancellation date') }),
    cancelReason: f.text({ label: label('取消理由', 'Cancellation reason'), ...owned, maxLength: 1000 }),
  },
  indexes: [['agreementId', 'month']],
  permissions: {
    roles: { accounting: ['read', 'create', 'update'], sales: ['read'], purchasing: ['read'] },
    rowRules: [
      { roles: ['sales'], where: { direction: 'bill' } },
      { roles: ['purchasing'], where: { direction: 'pay' } },
    ],
  },
  views: { list: ['agreementId', 'month', 'direction', 'fee', 'tax', 'total', 'status'] },
});
