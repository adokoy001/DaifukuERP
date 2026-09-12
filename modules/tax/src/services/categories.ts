// 税区分 (docs/domain/japan-tax.md#消費税: 課税/軽減/免税/非課税/不課税). The same enum is declared by
// product.taxCategory; tax is the owner of its meaning, product only copies the values (specs/tax.md).
import { label, type Label } from '@daifuku/kernel';

export const TAX_CATEGORIES = ['standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

export const TAX_CATEGORY_LABELS: Record<TaxCategory, Label> = {
  standard: label('課税（標準）', 'Taxable (standard)'),
  reduced: label('課税（軽減）', 'Taxable (reduced)'),
  exempt: label('免税', 'Exempt (export)'),
  non_taxable: label('非課税', 'Non-taxable'),
  out_of_scope: label('不課税', 'Out of scope'),
};

/** Categories whose rate is always 0 — no tax_rate row is needed for them to resolve (spec AC-2). */
export const ZERO_RATE_CATEGORIES: readonly TaxCategory[] = ['exempt', 'non_taxable', 'out_of_scope'];

/** Code/label used when a zero-rate category has no tax_rate row for the date. Seeds use the same codes (AC-8). */
export const ZERO_RATE_FALLBACK: Record<'exempt' | 'non_taxable' | 'out_of_scope', { code: string; label: string }> = {
  exempt: { code: 'EXEMPT', label: '免税' },
  non_taxable: { code: 'NONTAX', label: '非課税' },
  out_of_scope: { code: 'OOS', label: '不課税' },
};

export function isTaxCategory(v: unknown): v is TaxCategory {
  return typeof v === 'string' && (TAX_CATEGORIES as readonly string[]).includes(v);
}

export function isZeroRateCategory(c: TaxCategory): c is 'exempt' | 'non_taxable' | 'out_of_scope' {
  return ZERO_RATE_CATEGORIES.includes(c);
}
