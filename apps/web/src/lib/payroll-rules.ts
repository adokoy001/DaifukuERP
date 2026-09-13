import type { PayrollRuleSummary } from '../api/fiscal.ts';

type Range = { from: string; to: string };
export function withinRuleRange(value: string, range: Range): boolean {
  return value !== '' && value >= range.from && value <= range.to;
}

export function activePayrollRules(bundles: readonly PayrollRuleSummary[], taxYear: number): PayrollRuleSummary[] {
  return bundles.filter((bundle) => bundle.taxYear === taxYear && ['legacy', 'approved'].includes(bundle.status));
}

export function monthEnd(period: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return '';
  const date = new Date(period + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

export function payrollPaymentRange(period: string, bundle: PayrollRuleSummary): Range | undefined {
  const end = monthEnd(period);
  const applicable = bundle.manifest.applicability;
  if (!end || !withinRuleRange(end, applicable.wageCutoffDates)) return undefined;
  const next = new Date(end + 'T00:00:00Z');
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 2, 0);
  const from = end > applicable.paymentDates.from ? end : applicable.paymentDates.from;
  const last = next.toISOString().slice(0, 10);
  const to = last < applicable.paymentDates.to ? last : applicable.paymentDates.to;
  return from <= to ? { from, to } : undefined;
}

export function dateInRuleRange(today: string, range: Range): string {
  return today < range.from ? range.from : today > range.to ? range.to : today;
}

export function supportedPayrollBundle(
  bundles: readonly PayrollRuleSummary[],
  taxYear: number,
  period: string,
): PayrollRuleSummary | undefined {
  const matched = activePayrollRules(bundles, taxYear).filter((bundle) => payrollPaymentRange(period, bundle));
  return matched.length === 1 ? matched[0] : undefined;
}

export function supportedYearEndBundle(
  bundles: readonly PayrollRuleSummary[],
  taxYear: number,
): PayrollRuleSummary | undefined {
  const matched = activePayrollRules(bundles, taxYear);
  return matched.length === 1 ? matched[0] : undefined;
}
