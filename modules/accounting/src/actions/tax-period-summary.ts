// accounting.tax_period_summary (docs/specs/tax-period-summary.md AC-2..AC-4): 消費税集計表 built from the tax category
// and rate carried by posted journal lines (not from sales/purchase documents), so manual entries and reversals count.
// One aggregate query per (account, taxCategory, taxRate) and one account read by id; classification is pure
// (services/tax-summary.ts). No raw SQL.
import {
  Decimal,
  defineAction,
  isDecimal,
  label,
  repo,
  ValidationError,
  type Context,
  type LocalDate,
} from '@daifuku/kernel';
import { column, MAX_REPORT_ROWS, tableResult } from '@daifuku/kernel';
import { z } from 'zod';
import { Account, type AccountType, type TaxRole } from '../entities/account.ts';
import { JournalEntry } from '../entities/journal-entry.ts';
import { JournalLine } from '../entities/journal-line.ts';
import { taxSummaryRows, type TaxAccountInfo, type TaxLineGroup } from '../services/tax-summary.ts';
import { localDate } from './helpers.ts';

export const TAX_PERIOD_SUMMARY_COLUMNS = [
  column('side', label('売上/仕入', 'Sales/purchases'), 'text'),
  column('taxCategory', label('税区分', 'Tax category'), 'text'),
  column('taxCategoryLabel', label('税区分名', 'Tax category name'), 'text'),
  column('taxRate', label('税率', 'Tax rate'), 'text', { align: 'right' }),
  column('taxableAmount', label('税抜金額', 'Amount excl. tax'), 'decimal'),
  column('taxAmount', label('消費税額', 'Tax amount'), 'decimal'),
  column('count', label('明細数', 'Lines'), 'int'),
];

function decimalOrNull(v: unknown): Decimal | null {
  if (v === null || v === undefined) return null;
  return isDecimal(v) ? v : Decimal.from(String(v));
}

/** Posted lines dated from..to, grouped per (account, taxCategory, taxRate). */
async function lineGroups(
  ctx: Context,
  from: LocalDate,
  to: LocalDate,
): Promise<{ groups: TaxLineGroup[]; truncated: boolean }> {
  const rows = await repo(ctx, JournalLine).aggregate({
    where: { posted: true, $and: [{ entryDate: { $gte: from } }, { entryDate: { $lte: to } }] },
    groupBy: ['accountId', 'accountType', 'accountTaxRole', 'taxCategory', 'taxRate'],
    metrics: { debit: { sum: 'debit' }, credit: { sum: 'credit' }, lines: { count: true } },
    limit: MAX_REPORT_ROWS,
  });
  const groups = rows.map((r): TaxLineGroup => ({
    accountId: String(r.accountId),
    ...(typeof r.accountType === 'string' && typeof r.accountTaxRole === 'string'
      ? { accountAtPosting: { type: r.accountType as AccountType, taxRole: r.accountTaxRole as TaxRole } }
      : {}),
    taxCategory: typeof r.taxCategory === 'string' ? r.taxCategory : null,
    taxRate: decimalOrNull(r.taxRate),
    debit: decimalOrNull(r.debit) ?? Decimal.zero(),
    credit: decimalOrNull(r.credit) ?? Decimal.zero(),
    lines: Number(r.lines),
  }));
  return { groups, truncated: rows.length >= MAX_REPORT_ROWS };
}

async function loadTaxAccounts(ctx: Context, ids: readonly string[]): Promise<Map<string, TaxAccountInfo>> {
  const out = new Map<string, TaxAccountInfo>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 500) {
    const page = await repo(ctx, Account).list({ where: { id: { $in: unique.slice(i, i + 500) } }, limit: 500 });
    for (const a of page.items) out.set(a.id, { type: a.type, taxRole: a.taxRole });
  }
  return out;
}

export const taxPeriodSummaryAction = defineAction({
  name: 'accounting.tax_period_summary',
  description: label(
    '消費税集計表: from〜to（両端含む）の転記済み仕訳明細を「売上/仕入 × 税区分 × 税率」で集計し、税抜金額と消費税額（taxRole が output_tax / input_tax の科目の明細）を返します。totals に売上税額・仕入税額・差引税額。税区分の無い仮受/仮払消費税は unclassified 行に入ります。',
    'Consumption tax summary: posted journal lines dated from..to (inclusive) grouped by sales/purchases × tax category × rate, with the amount excluding tax and the tax amount (lines on accounts whose taxRole is output_tax / input_tax). totals: output tax, input tax, net tax due. Tax lines without a category/rate go to an unclassified row.',
  ),
  input: z.object({ from: localDate, to: localDate }),
  output: tableResult,
  exportEntities: ['account', 'journal_line'],
  permission: { entity: JournalEntry.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: async (ctx, { from, to }) => {
    if (from > to)
      throw new ValidationError(
        `from ${from} is after to ${to}`,
        [{ path: 'to', message: 'must be on or after from' }],
        'Swap the dates: from is the first day and to the last day of the period (both inclusive).',
      );
    const { groups, truncated } = await lineGroups(ctx, from, to);
    const accounts = await loadTaxAccounts(
      ctx,
      groups.map((g) => g.accountId),
    );
    const { rows, totals } = taxSummaryRows(groups, accounts);
    return {
      title: label(`消費税集計表 ${from}〜${to}`, `Consumption tax summary ${from}..${to}`),
      columns: TAX_PERIOD_SUMMARY_COLUMNS,
      rows,
      totals,
      meta: { from, to, ...(truncated ? { truncated: true } : {}) },
    };
  },
});
