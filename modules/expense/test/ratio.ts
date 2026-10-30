// Test data for the purchase credit-ratio override point (purchase.exempt_supplier_credit_ratio): the 経過措置 periods
// that matter to these tests, mirroring l10n/jp/src/services/transitional-credit.ts (docs/domain/japan-tax.md, Q&A 問113).
// modules/expense cannot import l10n/jp, so the tests register this table themselves.
import { Decimal, type LocalDate } from '@daifuku/kernel';
import type { CreditRatioInput } from '@daifuku/mod-purchase';

const TRANSITIONAL: readonly { from: string; to: string; ratio: string }[] = [
  { from: '2023-10-01', to: '2026-09-30', ratio: '0.8' },
  { from: '2026-10-01', to: '2028-09-30', ratio: '0.7' },
];

export function testCreditRatioForDate(date: LocalDate): Decimal {
  return Decimal.from(TRANSITIONAL.find((p) => date >= p.from && date <= p.to)?.ratio ?? '0');
}

export function testCreditRatio(input: CreditRatioInput): Decimal {
  return input.supplierTaxStatus === 'registered' ? Decimal.from(1) : testCreditRatioForDate(input.date);
}
