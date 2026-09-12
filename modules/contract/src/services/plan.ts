// What a contract bills for one period (spec AC-3 lines, AC-5 schedule). Pure: the generate action and the schedule
// report both call planPeriod, so the report's expected amount is exactly what generation would put on the invoice.
import { Decimal, type LocalDate, type RoundingMode } from '@daifuku/kernel';
import type { TaxCategory } from '@daifuku/mod-tax';
import { billingDate, DUE_SKIP_REASONS, dueReason, type BillingTiming, type DueTerms, type Period } from './periods.ts';
import { periodFactor, prorate, ZERO, type Fraction, type ProrationRule } from './proration.ts';

export const SKIP_REASONS = [...DUE_SKIP_REASONS, 'zero_amount'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export const PLAN_STATUSES = ['due', 'generated', 'not_due'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface ContractTerms extends DueTerms {
  billingDay: number;
  billingTiming: BillingTiming;
  prorationRule: ProrationRule;
  roundingMode: RoundingMode;
}

export interface TermLine {
  ext?: Record<string, unknown> | null;
  seq: number;
  productId: string | null;
  description: string;
  quantity: Decimal;
  /** Monthly price. */
  unitPrice: Decimal;
  taxCategory: TaxCategory;
}

export interface PlannedLine extends TermLine {
  /** Monthly price × period factor, rounded to the currency scale with the contract's rounding mode. */
  unitPrice: Decimal;
  /** quantity × prorated unit price (税抜). */
  amount: Decimal;
}

interface PlanBase {
  factor: Fraction;
  /** Lines with a non-zero amount (a line prorated to 0 is left off the invoice). */
  lines: PlannedLine[];
  /** Σ amount (税抜); 0 when not due. */
  subtotal: Decimal;
}

/** due: to be generated; generated: the ledger has the period; not_due: nothing is billed (no date, no lines). */
export type PeriodPlan =
  | (PlanBase & { status: 'due'; reason: null; billingDate: LocalDate })
  | (PlanBase & { status: 'generated'; reason: 'already_generated'; billingDate: LocalDate })
  | (PlanBase & { status: 'not_due'; reason: Exclude<SkipReason, 'already_generated'>; billingDate: null });
export type DuePlan = Extract<PeriodPlan, { status: 'due' }>;

export interface PlanInput {
  terms: ContractTerms;
  lines: readonly TermLine[];
  period: Period;
  alreadyGenerated: boolean;
  /** Currency scale of the company (JPY 0). */
  scale: number;
}

function notDue(reason: Exclude<SkipReason, 'already_generated'>): PeriodPlan {
  return { status: 'not_due', reason, billingDate: null, factor: ZERO, lines: [], subtotal: Decimal.zero() };
}

export function planPeriod({ terms, lines, period, alreadyGenerated, scale }: PlanInput): PeriodPlan {
  const reason = dueReason(terms, period, alreadyGenerated);
  if (reason !== null && reason !== 'already_generated') return notDue(reason);
  const factor = periodFactor(period, terms.intervalMonths, terms.startDate, terms.endDate, terms.prorationRule);
  const planned = lines
    .map((l) => {
      const unitPrice = prorate(l.unitPrice, factor, terms.roundingMode, scale);
      return { ...l, unitPrice, amount: l.quantity.times(unitPrice) };
    })
    .filter((l) => !l.amount.isZero());
  const subtotal = Decimal.sum(planned.map((l) => l.amount));
  const date = billingDate(period, terms.billingDay, terms.billingTiming);
  if (reason === 'already_generated') return { status: 'generated', reason, billingDate: date, factor, lines: planned, subtotal };
  if (planned.length === 0) return notDue('zero_amount');
  return { status: 'due', reason: null, billingDate: date, factor, lines: planned, subtotal };
}
