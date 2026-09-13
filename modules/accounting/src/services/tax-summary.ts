// 消費税集計表 (docs/specs/tax-period-summary.md AC-2..AC-4). Pure: takes journal lines already aggregated per
// (account, taxCategory, taxRate) and the accounts they belong to; no DB, Decimal only.
//   売上: revenue accounts, credit − debit (値引き・逆仕訳 subtract); 仮受消費税 (taxRole output_tax), credit − debit
//   仕入: expense / asset accounts, debit − credit (返品・逆仕訳 subtract); 仮払消費税 (taxRole input_tax), debit − credit
// Base lines without a taxCategory are not tax transactions (売掛金, 預金, 控除対象外消費税) and are skipped. Tax lines
// without a category or rate cannot be matched to a row and land in (side, 'unclassified', '') instead (AC-4).
import { Decimal, StateError } from '@daifuku/kernel';
import { TAX_CATEGORIES, TAX_CATEGORY_LABELS, type AccountType, type TaxRole } from '../entities/account.ts';

export const TAX_SIDES = { sales: '売上', purchase: '仕入' } as const;
export type TaxSide = (typeof TAX_SIDES)[keyof typeof TAX_SIDES];

export const UNCLASSIFIED = 'unclassified';
export const UNCLASSIFIED_LABEL = '未分類';

/** One aggregate row of posted journal lines. */
export interface TaxLineGroup {
  accountId: string;
  accountAtPosting?: TaxAccountInfo;
  taxCategory: string | null;
  taxRate: Decimal | null;
  debit: Decimal;
  credit: Decimal;
  lines: number;
}

export interface TaxAccountInfo {
  type: AccountType;
  taxRole: TaxRole;
}

export type TaxSummaryRow = {
  side: TaxSide;
  taxCategory: string;
  taxCategoryLabel: string;
  /** At least two decimals ('0.10', '0.08'); '' for the unclassified row. */
  taxRate: string;
  taxableAmount: string;
  taxAmount: string;
  count: number;
};

export type TaxSummaryTotals = {
  output_tax_total: string;
  input_tax_total: string;
  net_tax_due: string;
};

interface Classified {
  side: TaxSide;
  category: string;
  rate: Decimal | null;
  kind: 'base' | 'tax';
  amount: Decimal;
}

interface Bucket {
  side: TaxSide;
  category: string;
  rate: Decimal | null;
  taxable: Decimal;
  tax: Decimal;
  count: number;
}

/** '0.1' -> '0.10', '0.075' -> '0.075' (never drops digits). */
export function formatRate(rate: Decimal): string {
  const s = rate.toString();
  const decimals = s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
  return rate.toFixed(Math.max(2, decimals));
}

/** Where one aggregated line group goes, or null when it is not part of the summary. */
export function classifyGroup(group: TaxLineGroup, account: TaxAccountInfo | undefined): Classified | null {
  account = group.accountAtPosting;
  if (!account)
    throw new StateError(
      'Historical account classification is unavailable',
      'Recover the original account type and tax role from accounting records before running this report.',
    );
  const creditNet = group.credit.minus(group.debit);
  if (account.taxRole !== 'none') {
    const classified = group.taxCategory !== null && group.taxRate !== null;
    const sales = account.taxRole === 'output_tax';
    return {
      side: sales ? TAX_SIDES.sales : TAX_SIDES.purchase,
      category: classified ? (group.taxCategory ?? UNCLASSIFIED) : UNCLASSIFIED,
      rate: classified ? group.taxRate : null,
      kind: 'tax',
      amount: sales ? creditNet : creditNet.neg(),
    };
  }
  if (group.taxCategory === null) return null;
  if (account.type === 'revenue')
    return { side: TAX_SIDES.sales, category: group.taxCategory, rate: group.taxRate, kind: 'base', amount: creditNet };
  if (account.type === 'expense' || account.type === 'asset')
    return {
      side: TAX_SIDES.purchase,
      category: group.taxCategory,
      rate: group.taxRate,
      kind: 'base',
      amount: creditNet.neg(),
    };
  return null;
}

function bucketKey(c: Pick<Classified, 'side' | 'category' | 'rate'>): string {
  return `${c.side}|${c.category}|${c.rate === null ? '' : c.rate.toString()}`;
}

const SIDE_ORDER: readonly TaxSide[] = [TAX_SIDES.sales, TAX_SIDES.purchase];
const CATEGORY_ORDER: readonly string[] = [...TAX_CATEGORIES, UNCLASSIFIED];

function categoryRank(category: string): number {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

/** 売上 before 仕入, categories in TAX_CATEGORIES order then unclassified, higher rates first, no rate last. */
function compareBuckets(a: Bucket, b: Bucket): number {
  const side = SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side);
  if (side !== 0) return side;
  const category = categoryRank(a.category) - categoryRank(b.category);
  if (category !== 0) return category;
  if (a.rate === null || b.rate === null) return (a.rate === null ? 1 : 0) - (b.rate === null ? 1 : 0);
  return b.rate.cmp(a.rate);
}

function categoryLabel(category: string): string {
  if (category === UNCLASSIFIED) return UNCLASSIFIED_LABEL;
  const known = Object.entries(TAX_CATEGORY_LABELS).find(([code]) => code === category);
  return known ? known[1].ja : category;
}

/** Rows per (side, taxCategory, taxRate) and the output / input / net totals. */
export function taxSummaryRows(
  groups: readonly TaxLineGroup[],
  accounts: ReadonlyMap<string, TaxAccountInfo>,
): { rows: TaxSummaryRow[]; totals: TaxSummaryTotals } {
  const buckets = new Map<string, Bucket>();
  let output = Decimal.zero();
  let input = Decimal.zero();
  for (const g of groups) {
    const c = classifyGroup(g, accounts.get(g.accountId));
    if (!c) continue;
    const key = bucketKey(c);
    const b = buckets.get(key) ?? {
      side: c.side,
      category: c.category,
      rate: c.rate,
      taxable: Decimal.zero(),
      tax: Decimal.zero(),
      count: 0,
    };
    if (c.kind === 'base') b.taxable = b.taxable.plus(c.amount);
    else b.tax = b.tax.plus(c.amount);
    b.count += g.lines;
    buckets.set(key, b);
    if (c.kind === 'tax' && c.side === TAX_SIDES.sales) output = output.plus(c.amount);
    if (c.kind === 'tax' && c.side === TAX_SIDES.purchase) input = input.plus(c.amount);
  }
  const rows = [...buckets.values()].sort(compareBuckets).map((b): TaxSummaryRow => ({
    side: b.side,
    taxCategory: b.category,
    taxCategoryLabel: categoryLabel(b.category),
    taxRate: b.rate === null ? '' : formatRate(b.rate),
    taxableAmount: b.taxable.toString(),
    taxAmount: b.tax.toString(),
    count: b.count,
  }));
  return {
    rows,
    totals: {
      output_tax_total: output.toString(),
      input_tax_total: input.toString(),
      net_tax_due: output.minus(input).toString(),
    },
  };
}
