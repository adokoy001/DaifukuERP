// accounting.trial_balance (spec AC-8): one row per account from two aggregate queries over posted lines
// (before `from`, and from..to), no raw SQL. Balances are debit-positive.
import { defineAction, label, repo, type Context, type Decimal, type Domain } from '@daifuku/kernel';
import { z } from 'zod';
import { Account } from '../entities/account.ts';
import { JournalLine } from '../entities/journal-line.ts';
import { trialBalanceRows, type Movement } from '../services/ledger.ts';
import { column, MAX_REPORT_ROWS, tableResult } from '@daifuku/kernel';
import { listAll, localDate, resolveReportRange } from './helpers.ts';

/** Σdebit / Σcredit per account over posted lines matching `where`. */
export async function movementsByAccount(ctx: Context, where: Domain): Promise<Map<string, Movement>> {
  const rows = await repo(ctx, JournalLine).aggregate({ where: { posted: true, ...where }, groupBy: ['accountId'], metrics: { debit: { sum: 'debit' }, credit: { sum: 'credit' } } });
  const out = new Map<string, Movement>();
  for (const r of rows) out.set(String(r.accountId), { debit: r.debit as Decimal, credit: r.credit as Decimal });
  return out;
}

export const TRIAL_BALANCE_COLUMNS = [
  column('code', label('科目コード', 'Code'), 'text'),
  column('name', label('科目名', 'Account'), 'text'),
  column('type', label('区分', 'Type'), 'text'),
  column('openingDebit', label('期首借方', 'Opening debit'), 'decimal'),
  column('openingCredit', label('期首貸方', 'Opening credit'), 'decimal'),
  column('periodDebit', label('期間借方', 'Period debit'), 'decimal'),
  column('periodCredit', label('期間貸方', 'Period credit'), 'decimal'),
  column('closingBalance', label('残高（借方+／貸方−）', 'Closing balance (debit +, credit −)'), 'decimal'),
  column('accountId', label('科目', 'Account'), 'ref', { ref: Account.name }),
];

export const trialBalanceAction = defineAction({
  name: 'accounting.trial_balance',
  description: label(
    '試算表を返します。勘定科目ごとに、from より前の期首残高（借方/貸方）、from〜to の期間借方・貸方、期末残高（借方+／貸方−）。転記済み仕訳のみ集計。既定は当年度の期首〜今日。',
    'Trial balance: per account, opening balance before `from` (debit/credit side), period debit/credit for from..to, and closing balance (debit +, credit −). Posted entries only. Defaults: current fiscal year start .. today.',
  ),
  input: z.object({ from: localDate.optional(), to: localDate.optional() }),
  output: tableResult,
  exportEntities: ['account', 'journal_line', 'fiscal_year'],
  permission: { entity: JournalLine.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: async (ctx, input) => {
    const { from, to } = await resolveReportRange(ctx, input.from, input.to);
    const accounts = await listAll(ctx, Account, { orderBy: [{ field: 'code', dir: 'asc' }] }, MAX_REPORT_ROWS);
    const opening = await movementsByAccount(ctx, { entryDate: { $lt: from } });
    const period = await movementsByAccount(ctx, { $and: [{ entryDate: { $gte: from } }, { entryDate: { $lte: to } }] });
    const { rows, totals } = trialBalanceRows(accounts.items, opening, period);
    return {
      title: label(`試算表 ${from}〜${to}`, `Trial balance ${from}..${to}`),
      columns: TRIAL_BALANCE_COLUMNS,
      rows,
      totals,
      meta: { from, to, accounts: rows.length, ...(accounts.truncated ? { truncated: true } : {}) },
    };
  },
});
