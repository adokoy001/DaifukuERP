// 免税事業者等からの課税仕入れに係る経過措置 (spec AC-3). The credit ratio is DATA with validity periods, never a constant
// (CLAUDE.md rule 10, ADR-0011). Source: docs/domain/japan-tax.md#インボイス制度 — 国税庁 令和8年度税制改正特集 / Q&A 問113
// (https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice_qa.htm, 確認 2026-09-10):
//   80% (2023-10-01〜2026-09-30) → 70% (2026-10-01〜2028-09-30) → 50% (2028-10-01〜2030-09-30) → 30% (2030-10-01〜2031-09-30) → 0%.
// Before the invoice system started (2023-10-01, 区分記載請求書等保存方式) purchases from exempt suppliers were fully creditable —
// 国税庁 タックスアンサー No.6497 (https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6497.htm, 確認 2026-09-10).
// The 1億円/年 per-supplier cap (Q&A 問113) is out of scope here: the override input carries no yearly total (spec purchase.md).
import { Decimal, ValidationError, isLocalDate, type LocalDate } from '@daifuku/kernel';

/** Override point exposed by modules/purchase (docs/specs/purchase.md AC-2). */
export const EXEMPT_SUPPLIER_CREDIT_RATIO_OVERRIDE = 'purchase.exempt_supplier_credit_ratio';

export const SUPPLIER_TAX_STATUSES = ['registered', 'exempt'] as const;
export type SupplierTaxStatus = (typeof SUPPLIER_TAX_STATUSES)[number];

/** Contract copied from docs/specs/purchase.md (l10n must not import modules/purchase). */
export interface ExemptSupplierCreditRatioInput {
  supplierTaxStatus: SupplierTaxStatus;
  date: LocalDate;
}
export type ExemptSupplierCreditRatioFn = (input: ExemptSupplierCreditRatioInput) => Decimal;

export interface CreditRatioPeriod {
  /** null = open start. */
  validFrom: LocalDate | null;
  /** null = open end. */
  validTo: LocalDate | null;
  /** Decimal string (ratio, not percent). */
  ratio: string;
  label: string;
}

/** Contiguous, non-overlapping, ordered by date. Add a row (and close the previous one) when the law changes. */
export const EXEMPT_SUPPLIER_CREDIT_RATIOS: readonly CreditRatioPeriod[] = [
  { validFrom: null, validTo: '2023-09-30', ratio: '1', label: '区分記載請求書等保存方式（全額控除）' },
  { validFrom: '2023-10-01', validTo: '2026-09-30', ratio: '0.8', label: '経過措置 80%' },
  { validFrom: '2026-10-01', validTo: '2028-09-30', ratio: '0.7', label: '経過措置 70%（令和8年度改正）' },
  { validFrom: '2028-10-01', validTo: '2030-09-30', ratio: '0.5', label: '経過措置 50%（令和8年度改正）' },
  { validFrom: '2030-10-01', validTo: '2031-09-30', ratio: '0.3', label: '経過措置 30%（令和8年度改正）' },
  { validFrom: '2031-10-01', validTo: null, ratio: '0', label: '経過措置終了（控除不可）' },
];

export const FULL_CREDIT = Decimal.from(1);

function inPeriod(p: CreditRatioPeriod, date: LocalDate): boolean {
  if (p.validFrom !== null && date < p.validFrom) return false;
  if (p.validTo !== null && date > p.validTo) return false;
  return true;
}

/** The 経過措置 ratio for a business date, looked up in `table` (defaults to the statutory table above). */
export function transitionalCreditRatio(date: LocalDate, table: readonly CreditRatioPeriod[] = EXEMPT_SUPPLIER_CREDIT_RATIOS): Decimal {
  if (!isLocalDate(date)) throw new ValidationError(`invalid date "${date}"`, [{ path: 'date', message: 'must be YYYY-MM-DD' }]);
  const row = table.find((p) => inPeriod(p, date));
  if (!row) {
    throw new ValidationError(`no exempt-supplier credit ratio is defined for ${date}`, [{ path: 'date', message: 'outside every validity period' }], 'Add a row to EXEMPT_SUPPLIER_CREDIT_RATIOS (l10n/jp/src/services/transitional-credit.ts)');
  }
  return Decimal.from(row.ratio);
}

/** The override registered under `purchase.exempt_supplier_credit_ratio`: registered suppliers → 1, exempt → by date. */
export const exemptSupplierCreditRatio: ExemptSupplierCreditRatioFn = (input) => {
  if (input.supplierTaxStatus === 'registered') return FULL_CREDIT;
  if (input.supplierTaxStatus !== 'exempt') {
    throw new ValidationError(`unknown supplierTaxStatus "${String(input.supplierTaxStatus)}"`, [{ path: 'supplierTaxStatus', message: `must be one of ${SUPPLIER_TAX_STATUSES.join(', ')}` }]);
  }
  return transitionalCreditRatio(input.date);
};
