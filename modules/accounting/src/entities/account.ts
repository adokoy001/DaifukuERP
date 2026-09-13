// Chart of accounts entry (spec AC-1). The Japanese chart itself is seeded by l10n/jp, not here (AC-11).
import { defineEntity, f, label } from '@daifuku/kernel';

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Shared with modules/tax and modules/product by value, not by import (docs/specs/tax.md). */
export const TAX_CATEGORIES = ['standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

export const TAX_CATEGORY_LABELS = {
  standard: label('標準税率', 'Standard rate'),
  reduced: label('軽減税率', 'Reduced rate'),
  exempt: label('免税', 'Exempt'),
  non_taxable: label('非課税', 'Non-taxable'),
  out_of_scope: label('不課税', 'Out of scope'),
} as const;

/** Marks the 仮受消費税 / 仮払消費税 accounts so accounting.tax_period_summary can tell tax lines from base lines. */
export const TAX_ROLES = ['none', 'output_tax', 'input_tax'] as const;
export type TaxRole = (typeof TAX_ROLES)[number];

export const TAX_ROLE_LABELS = {
  none: label('なし', 'None'),
  output_tax: label('仮受消費税（売上税額）', 'Output tax'),
  input_tax: label('仮払消費税（仕入税額）', 'Input tax'),
} as const;

export const Account = defineEntity({
  name: 'account',
  label: label('勘定科目', 'Account'),
  fields: {
    code: f.text({ label: label('科目コード', 'Code'), required: true, unique: true, immutable: true, maxLength: 20 }),
    name: f.text({ label: label('科目名', 'Name'), required: true, maxLength: 100 }),
    nameKana: f.text({ label: label('科目名カナ', 'Name (kana)'), normalize: 'halfwidth-kana', maxLength: 100 }),
    type: f.enum(ACCOUNT_TYPES, {
      label: label('区分', 'Type'),
      required: true,
      labels: {
        asset: label('資産', 'Asset'),
        liability: label('負債', 'Liability'),
        equity: label('純資産', 'Equity'),
        revenue: label('収益', 'Revenue'),
        expense: label('費用', 'Expense'),
      },
    }),
    subtype: f.text({
      label: label('小区分', 'Subtype'),
      description: label(
        '現金預金／売掛金／買掛金／仮受消費税／仮払消費税／売上／仕入／販管費 など',
        'e.g. cash, receivable, payable, output tax, input tax, sales, purchases, SG&A',
      ),
      maxLength: 50,
      index: true,
    }),
    isActive: f.bool({ label: label('有効', 'Active'), required: true, default: true }),
    taxCategoryDefault: f.enum(TAX_CATEGORIES, {
      label: label('既定の税区分', 'Default tax category'),
      labels: TAX_CATEGORY_LABELS,
    }),
    taxRole: f.enum(TAX_ROLES, {
      label: label('消費税の役割', 'Consumption tax role'),
      description: label(
        '仮受消費税は output_tax、仮払消費税は input_tax（消費税集計表が税額行として扱う）',
        'output_tax for 仮受消費税, input_tax for 仮払消費税 (the tax period summary reads these lines as tax amounts)',
      ),
      required: true,
      default: 'none',
      labels: TAX_ROLE_LABELS,
    }),
    partnerRequired: f.bool({
      label: label('取引先必須', 'Partner required'),
      description: label(
        '売掛金・買掛金は true（明細に取引先が無いと転記不可）',
        'true for receivables/payables: lines must carry a partner',
      ),
      required: true,
      default: false,
    }),
  },
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update'],
      // Modules that post to the ledger (sales/purchase/payment) read accounts in their own role's context.
      sales: ['read'],
      purchasing: ['read'],
      viewer: ['read'],
    },
  },
  views: {
    list: ['code', 'name', 'type', 'subtype', 'partnerRequired', 'isActive'],
    search: ['code', 'name', 'nameKana'],
    form: [
      ['code', 'name', 'nameKana'],
      ['type', 'subtype'],
      ['taxCategoryDefault', 'taxRole'],
      ['partnerRequired', 'isActive'],
    ],
  },
});

export type AccountDef = typeof Account;
