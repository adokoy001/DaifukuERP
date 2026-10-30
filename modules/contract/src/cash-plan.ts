// Planned contract receipts for the cash forecast (docs/specs/cash-forecast.md D-4 `contract`, AC-7, AC-19, AC-28).
// For every submitted contract (active or ended) the aligned periods are walked from the start month; a period that
// planPeriod reports as `due` (no invoice yet) becomes a planned receipt when its billing date falls in
// [windowStart, to], windowStart being the first day of the month twelve months before today's month. The amount is
// the tax-inclusive total contract.generate_invoices would put on the invoice (same planPeriod lines, same tax
// functions as taxSummaryFor with the billing date and tax-exclusive prices) and the date is the invoice's due date
// (computeDueDate with the partner's terms). Older due periods are only counted (backlog, tax-exclusive): they are not
// expected receipts and resolving their historical tax rates must not fail the forecast.
// Contracts, lines, billing records, partners, tax rates and settings are read once, in the caller's context; the
// per-period planning runs in memory. The window never depends on the report's `from`.
import { Decimal, DOCSTATUS, getCompany, repo, StateError, type Context, type LocalDate } from '@daifuku/kernel';
import { computeDueDate, Partner } from '@daifuku/mod-partner';
import {
  loadTaxRates,
  loadTaxSettings,
  resolveRate,
  summarizeTax,
  taxScaleForCurrency,
  type ResolvedRate,
  type TaxCategory,
} from '@daifuku/mod-tax';
import { ContractBilling } from './entities/contract-billing.ts';
import { Contract } from './entities/contract.ts';
import { allPages, inChunks } from './ledger.ts';
import { companyScale, linesByContract, termsOf, type ContractRow } from './load.ts';
import { addMonths, periodOf, periodStart, type Period } from './services/periods.ts';
import { planPeriod, type PlannedLine } from './services/plan.ts';

/** Months before today's month where the planning window starts (intervalMonths is at most 12). */
export const CONTRACT_CASH_WINDOW_MONTHS = 12;

const PAGE = 500;

export interface PlannedContractReceipt {
  contractId: string;
  contractNumber: string | null;
  partnerId: string;
  period: Period;
  billingDate: LocalDate;
  /** Due date of the invoice the period would produce. */
  dueDate: LocalDate;
  subtotal: Decimal;
  tax: Decimal;
  total: Decimal;
}

export interface ContractCashPlan {
  windowStart: LocalDate;
  receipts: PlannedContractReceipt[];
  /** Due periods billed before windowStart that have no invoice (tax-exclusive subtotal). */
  backlog: { count: number; subtotal: Decimal };
}

/** First day of the month CONTRACT_CASH_WINDOW_MONTHS before today's month. */
export function contractCashWindowStart(today: LocalDate): LocalDate {
  return periodStart(addMonths(periodOf(today), -CONTRACT_CASH_WINDOW_MONTHS));
}

async function billablePeriodsBilled(ctx: Context, ids: readonly string[]): Promise<Map<string, Set<Period>>> {
  const r = repo(ctx, ContractBilling);
  const rows = await inChunks(ids, (chunk) =>
    allPages((offset) =>
      r.list({ where: { contractId: { $in: chunk } }, orderBy: [{ field: 'id' }], limit: PAGE, offset }),
    ),
  );
  const out = new Map<string, Set<Period>>();
  for (const b of rows) {
    const set = out.get(b.contractId) ?? new Set<Period>();
    set.add(b.period);
    out.set(b.contractId, set);
  }
  return out;
}

type PartnerTerms = { closingDay: number; paymentMonthOffset: number; paymentDay: number };

async function partnerTerms(ctx: Context, ids: readonly string[]): Promise<Map<string, PartnerTerms>> {
  const r = repo(ctx, Partner);
  const rows = await inChunks(
    ids,
    async (chunk) => (await r.list({ where: { id: { $in: chunk } }, limit: chunk.length })).items,
  );
  return new Map(rows.map((p) => [p.id, p]));
}

/** Tax of one planned invoice: the same calculation taxSummaryFor performs for a tax-exclusive document. */
type TaxOf = (date: LocalDate, lines: readonly PlannedLine[]) => { tax: Decimal; total: Decimal };

async function taxCalculator(ctx: Context): Promise<TaxOf> {
  const rates = await loadTaxRates(ctx);
  const settings = await loadTaxSettings(ctx);
  const scale = taxScaleForCurrency((await getCompany(ctx)).currency);
  return (date, lines) => {
    const resolved = new Map<TaxCategory, ResolvedRate>();
    const input = lines.map((l) => {
      const r = resolved.get(l.taxCategory) ?? resolveRate(rates, l.taxCategory, date);
      resolved.set(l.taxCategory, r);
      return { amount: l.amount, category: l.taxCategory, rate: r.rate };
    });
    const summary = summarizeTax(input, { roundingMode: settings.rounding.mode, scale, priceIncludesTax: false });
    return { tax: summary.totals.tax, total: summary.totals.gross };
  };
}

async function loadContracts(ctx: Context): Promise<ContractRow[]> {
  const r = repo(ctx, Contract);
  return allPages((offset) =>
    r.list({
      where: { docstatus: DOCSTATUS.submitted, status: { $in: ['active', 'ended'] } },
      orderBy: [{ field: 'number', dir: 'asc' }],
      limit: PAGE,
      offset,
    }),
  );
}

/** Planned receipts of every submitted contract up to `to` (spec D-4); `today` fixes the window. */
export async function plannedContractReceipts(
  ctx: Context,
  input: { today: LocalDate; to: LocalDate },
): Promise<ContractCashPlan> {
  const windowStart = contractCashWindowStart(input.today);
  const contracts = await loadContracts(ctx);
  const ids = contracts.map((c) => c.id);
  const billed = await billablePeriodsBilled(ctx, ids);
  const lines = await linesByContract(ctx, ids);
  const scale = await companyScale(ctx);
  const lastPeriod = periodOf(input.to);
  const due: { contract: ContractRow; period: Period; billingDate: LocalDate; lines: PlannedLine[] }[] = [];
  const backlog = { count: 0, subtotal: Decimal.zero() };
  for (const contract of contracts) {
    const terms = termsOf(contract);
    const done = billed.get(contract.id) ?? new Set<Period>();
    for (let period = periodOf(contract.startDate); period <= lastPeriod;) {
      if (contract.endDate !== null && contract.endDate < periodStart(period)) break;
      const plan = planPeriod({
        terms,
        lines: lines.get(contract.id) ?? [],
        period,
        alreadyGenerated: done.has(period),
        scale,
      });
      if (plan.status === 'due' && plan.billingDate <= input.to) {
        if (plan.billingDate < windowStart) {
          backlog.count += 1;
          backlog.subtotal = backlog.subtotal.plus(plan.subtotal);
        } else due.push({ contract, period, billingDate: plan.billingDate, lines: plan.lines });
      }
      period = addMonths(period, terms.intervalMonths);
    }
  }
  if (due.length === 0) return { windowStart, receipts: [], backlog };
  const taxOf = await taxCalculator(ctx);
  const partners = await partnerTerms(
    ctx,
    due.map((d) => d.contract.partnerId),
  );
  const receipts = due.map(({ contract, period, billingDate, lines: planned }) => {
    const partner = partners.get(contract.partnerId);
    if (!partner)
      throw new StateError(
        `partner ${contract.partnerId} of contract ${contract.number ?? contract.id} is not readable`,
        'Check that the contract partner exists in this company.',
      );
    const { tax, total } = taxOf(billingDate, planned);
    return {
      contractId: contract.id,
      contractNumber: contract.number,
      partnerId: contract.partnerId,
      period,
      billingDate,
      dueDate: computeDueDate(billingDate, partner.closingDay, partner.paymentMonthOffset, partner.paymentDay),
      subtotal: Decimal.sum(planned.map((l) => l.amount)),
      tax,
      total,
    };
  });
  return { windowStart, receipts, backlog };
}
