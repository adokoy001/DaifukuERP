import { Decimal, getCompany, repo, StateError, type Context } from '@daifuku/kernel';
import {
  Account,
  FiscalPeriod,
  FiscalYear,
  JournalEntry,
  JournalLine,
  taxSummaryRows,
  type TaxLineGroup,
} from '@daifuku/mod-accounting';
import { accountingProfileData } from './contract.ts';
import { allRows, issue, rowVersions } from './common.ts';
import type { FilingSource, LedgerBalance } from './profile.ts';
import { FilingAccountingProfile } from './entities.ts';
import { ledgerIntegrityIssues } from './ledger-validation.ts';
const D = Decimal.from;
export async function accountingSource(ctx: Context, yearId: string): Promise<FilingSource> {
  const company = await getCompany(ctx),
    year = await repo(ctx, FiscalYear).get(yearId);
  const profiles = await allRows(ctx, FilingAccountingProfile),
    saved = profiles[0];
  if (!saved) throw new StateError('会計申告準備の設定がありません', '法人名と科目分類を保存してください。');
  const profile = accountingProfileData.parse(saved.data),
    accounts = await allRows(ctx, Account, {}, 2000);
  const periods = await allRows(ctx, FiscalPeriod, { fiscalYearId: year.id });
  const entries = await allRows(ctx, JournalEntry, { date: { $lte: year.endDate } });
  const lines = await allRows(ctx, JournalLine, { posted: true, entryDate: { $lte: year.endDate } });
  const issues = ledgerIntegrityIssues(year, periods, entries, lines),
    accountMap = new Map(accounts.map((a) => [a.id, a])),
    entriesById = new Map(entries.map((e) => [e.id, e]));
  if (!periods.length || periods.some((r) => !r.isClosed))
    issues.push(issue('period_open', '年度の全会計期間を締めてから確認してください。'));
  if (entries.some((e) => e.date >= year.startDate && e.docstatus === 0))
    issues.push(issue('draft_entry', '年度内に未転記の仕訳が残っています。'));
  if (year.endDate > ctx.now().toISOString().slice(0, 10))
    issues.push(issue('future_year', '会計年度がまだ終了していません。'));
  const sums = new Map<string, { opening: Decimal; debit: Decimal; credit: Decimal }>(),
    taxGroups: TaxLineGroup[] = [];
  for (const l of lines) {
    const account = accountMap.get(l.accountId),
      entry = entriesById.get(l.entryId);
    if (
      !account ||
      !entry ||
      entry.docstatus !== 1 ||
      entry.date !== l.entryDate ||
      !l.accountType ||
      !l.accountTaxRole
    ) {
      issues.push(issue('posting_snapshot', '転記済み仕訳の分類・親仕訳に不足または不一致があります。', l.id));
      continue;
    }
    if (account.type !== l.accountType)
      issues.push(
        issue(
          'account_type_changed',
          '科目区分が転記時から変更されています。分類と残高を点検してください。',
          account.id,
        ),
      );
    const value = sums.get(l.accountId) ?? { opening: D(0), debit: D(0), credit: D(0) };
    if (entry.date < year.startDate) value.opening = value.opening.plus(l.debit).minus(l.credit);
    else {
      value.debit = value.debit.plus(l.debit);
      value.credit = value.credit.plus(l.credit);
      taxGroups.push({
        accountId: l.accountId,
        accountAtPosting: { type: l.accountType, taxRole: l.accountTaxRole },
        taxCategory: l.taxCategory,
        taxRate: l.taxRate,
        debit: l.debit,
        credit: l.credit,
        lines: 1,
      });
    }
    sums.set(l.accountId, value);
  }
  const balances: LedgerBalance[] = accounts
    .filter((a) => sums.has(a.id))
    .map((a) => {
      const v = sums.get(a.id) ?? { opening: D(0), debit: D(0), credit: D(0) };
      return {
        accountId: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
        opening: v.opening.toString(),
        debit: v.debit.toString(),
        credit: v.credit.toString(),
        closing: v.opening.plus(v.debit).minus(v.credit).toString(),
      };
    });
  const closing = balances.reduce((sum, r) => sum.plus(r.closing), D(0)),
    movement = balances.reduce((sum, r) => sum.plus(r.debit).minus(r.credit), D(0));
  if (!closing.eq(0) || !movement.eq(0))
    issues.push(issue('unbalanced_ledger', '仕訳の借貸または期末残高が一致しません。'));
  for (const r of balances)
    if (['revenue', 'expense'].includes(r.type) && !D(r.opening).eq(0))
      issues.push(issue('opening_income', '期首に損益科目残高があります。前期繰越を整理してください。', r.accountId));
  if (taxGroups.some((g) => g.taxCategory === null && ['revenue', 'expense'].includes(g.accountAtPosting?.type ?? '')))
    issues.push(
      issue(
        'tax_category_missing',
        '税区分が未設定の収益・費用明細があります。原資料から分類を確認してください。',
        null,
        'warning',
      ),
    );
  const tax = taxSummaryRows(taxGroups, new Map(accounts.map((a) => [a.id, { type: a.type, taxRole: a.taxRole }])));
  if (tax.rows.some((r) => r.taxCategory === 'unclassified'))
    issues.push(
      issue(
        'tax_unclassified',
        '消費税の未分類明細があります。税務上の扱いを原資料から確認してください。',
        null,
        'warning',
      ),
    );
  if (lines.length === 0) issues.push(issue('empty_ledger', '転記済み仕訳がありません。'));
  return {
    kind: 'accounting',
    country: company.country,
    currency: company.currency,
    from: year.startDate,
    to: year.endDate,
    profile,
    balances,
    payrollRows: [],
    issues,
    totals: { ledgerBalance: closing.toString(), movementBalance: movement.toString(), statutoryTaxDue: null },
    versions: [
      ...rowVersions(FilingAccountingProfile, [saved]),
      ...rowVersions(Account, accounts),
      ...rowVersions(FiscalYear, [year]),
      ...rowVersions(FiscalPeriod, periods),
      ...rowVersions(JournalEntry, entries),
      ...rowVersions(JournalLine, lines),
    ],
    records: {
      company: { id: company.id, country: company.country, currency: company.currency },
      profile: saved,
      year,
      periods,
      entries,
      lines,
      accounts,
      taxSummary: tax,
    },
  };
}
