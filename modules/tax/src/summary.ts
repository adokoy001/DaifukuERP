// Company-aware entry points (spec AC-6/AC-7 and the sales/purchase call site): load the company's tax_rate rows and
// settings through kernel ports, then delegate to the pure functions in services/compute.ts.
import { getCompany, getSetting, repo, type Context, type Decimal, type Infer, type LocalDate, type RoundingMode } from '@daifuku/kernel';
import { TaxRate } from './entities/tax-rate.ts';
import type { TaxCategory } from './services/categories.ts';
import { resolveRate, summarizeTax, taxScaleForCurrency, type ResolvedRate, type TaxGroup, type TaxTotals } from './services/compute.ts';
import {
  TAX_PRICE_INCLUDES_TAX_DEFAULT,
  TAX_PRICE_INCLUDES_TAX_KEY,
  TAX_ROUNDING_DEFAULT,
  TAX_ROUNDING_KEY,
  taxPriceIncludesTaxSchema,
  taxRoundingSchema,
  type TaxSettings,
} from './services/settings.ts';

export interface DocumentTaxLine {
  amount: Decimal | string;
  category: TaxCategory;
}

export interface DocumentTaxInput {
  date: LocalDate;
  lines: readonly DocumentTaxLine[];
  /** Overrides the company setting `tax.priceIncludesTax` for this document. */
  priceIncludesTax?: boolean | undefined;
}

export interface DocumentTaxGroup extends TaxGroup {
  code: string;
  label: string;
}

export interface DocumentTaxSummary {
  date: LocalDate;
  priceIncludesTax: boolean;
  rounding: { mode: RoundingMode; unit: TaxSettings['rounding']['unit']; scale: number };
  groups: DocumentTaxGroup[];
  totals: TaxTotals;
}

/** All tax_rate rows of the company (a company has a handful; date filtering is done in memory by resolveRate). */
export async function loadTaxRates(ctx: Context): Promise<Infer<typeof TaxRate>[]> {
  return (await repo(ctx, TaxRate).list({ limit: 500, orderBy: [{ field: 'validFrom', dir: 'asc' }] })).items;
}

export async function loadTaxSettings(ctx: Context): Promise<TaxSettings> {
  const rounding = await getSetting(ctx, TAX_ROUNDING_KEY, taxRoundingSchema, TAX_ROUNDING_DEFAULT);
  const priceIncludesTax = await getSetting(ctx, TAX_PRICE_INCLUDES_TAX_KEY, taxPriceIncludesTaxSchema, TAX_PRICE_INCLUDES_TAX_DEFAULT);
  return { rounding, priceIncludesTax };
}

/** AC-6: the company's rate for a category on a date. */
export async function resolveRateFor(ctx: Context, category: TaxCategory, date: LocalDate): Promise<ResolvedRate> {
  return resolveRate(await loadTaxRates(ctx), category, date);
}

/**
 * AC-7: the per-rate summary a sales/purchase document needs on validate/submit. Rates come from the company's
 * tax_rate rows for `date`; rounding mode from `tax.rounding`; scale from the company currency (JPY = 0).
 */
export async function taxSummaryFor(ctx: Context, input: DocumentTaxInput): Promise<DocumentTaxSummary> {
  const rates = await loadTaxRates(ctx);
  const settings = await loadTaxSettings(ctx);
  const company = await getCompany(ctx);
  const priceIncludesTax = input.priceIncludesTax ?? settings.priceIncludesTax;
  const scale = taxScaleForCurrency(company.currency);
  const resolved = new Map<TaxCategory, ResolvedRate>();
  const lines = input.lines.map((l) => {
    const r = resolved.get(l.category) ?? resolveRate(rates, l.category, input.date);
    resolved.set(l.category, r);
    return { amount: l.amount, category: l.category, rate: r.rate };
  });
  const summary = summarizeTax(lines, { roundingMode: settings.rounding.mode, scale, priceIncludesTax });
  const groups = summary.groups.map((g) => {
    const r = resolved.get(g.category);
    return { ...g, code: r?.code ?? '', label: r?.label ?? '' };
  });
  return { date: input.date, priceIncludesTax, rounding: { mode: settings.rounding.mode, unit: settings.rounding.unit, scale }, groups, totals: summary.totals };
}
