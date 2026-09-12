// 仕入税額控除の控除率 (docs/specs/purchase.md AC-2). The core knows nothing about 経過措置: registered suppliers get full
// credit, exempt suppliers get none. A country pack (l10n/jp) overrides `PURCHASE_CREDIT_RATIO_POINT` with the statutory
// 80→70→50→30→0% table (docs/domain/japan-tax.md#インボイス制度), keyed by the override name so it never imports this module.
import { Decimal, StateError, ValidationError, isDecimal, type LocalDate } from '@daifuku/kernel';

/** Override point name (ADR-0008). l10n packs call `registry.registerOverride(PURCHASE_CREDIT_RATIO_POINT, fn)`. */
export const PURCHASE_CREDIT_RATIO_POINT = 'purchase.exempt_supplier_credit_ratio';

export const SUPPLIER_TAX_STATUSES = ['registered', 'exempt'] as const;
export type SupplierTaxStatus = (typeof SUPPLIER_TAX_STATUSES)[number];

export interface CreditRatioInput {
  supplierTaxStatus: SupplierTaxStatus;
  /** Business date of the bill (YYYY-MM-DD). */
  date: LocalDate;
}

/** Contract of the override: a ratio in [0, 1]. Must be pure and synchronous. */
export type CreditRatioFn = (input: CreditRatioInput) => Decimal;

export const FULL_CREDIT: Decimal = Decimal.from(1);
export const NO_CREDIT: Decimal = Decimal.zero();

export function isSupplierTaxStatus(v: unknown): v is SupplierTaxStatus {
  return typeof v === 'string' && (SUPPLIER_TAX_STATUSES as readonly string[]).includes(v);
}

/** Default when no pack overrides the point: registered → 1, exempt → 0 (no transitional relief). */
export const defaultCreditRatio: CreditRatioFn = (input) => {
  if (!isSupplierTaxStatus(input.supplierTaxStatus)) {
    throw new ValidationError(`unknown supplierTaxStatus "${String(input.supplierTaxStatus)}"`, [{ path: 'supplierTaxStatus', message: `must be one of ${SUPPLIER_TAX_STATUSES.join(', ')}` }]);
  }
  return input.supplierTaxStatus === 'registered' ? FULL_CREDIT : NO_CREDIT;
};

/** Guards the module against a misbehaving override: the ratio must be a Decimal in [0, 1]. */
export function assertCreditRatio(ratio: unknown, input: CreditRatioInput): Decimal {
  if (!isDecimal(ratio) || ratio.isNegative() || ratio.gt(FULL_CREDIT)) {
    throw new StateError(
      `override ${PURCHASE_CREDIT_RATIO_POINT} returned an invalid credit ratio for ${input.supplierTaxStatus} on ${input.date}: ${String(ratio)}`,
      'The registered override must return a Decimal between 0 and 1. Fix the country pack that registered it.',
      { point: PURCHASE_CREDIT_RATIO_POINT, ...input, ratio: String(ratio) },
    );
  }
  return ratio;
}
