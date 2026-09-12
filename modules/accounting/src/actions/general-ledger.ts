// accounting.general_ledger (spec AC-9): posted lines of one account in date order with a running balance.
// Opening balance via the aggregate port; lines via list (paged); headers fetched by id for number/description.
import { Decimal, defineAction, label, repo, type Context, type Infer } from '@daifuku/kernel';
import { z } from 'zod';
import { Account } from '../entities/account.ts';
import { JournalEntry } from '../entities/journal-entry.ts';
import { JournalLine } from '../entities/journal-line.ts';
import { runningBalances } from '../services/ledger.ts';
import { column, MAX_REPORT_ROWS, tableResult } from '@daifuku/kernel';
import { listAll, localDate, resolveReportRange } from './helpers.ts';

type LineRow = Infer<typeof JournalLine>;
type HeadInfo = { number: string | null; description: string | null };

export const GENERAL_LEDGER_COLUMNS = [
  column('date', label('日付', 'Date'), 'date'),
  column('number', label('仕訳番号', 'Entry no.'), 'text'),
  column('description', label('摘要', 'Description'), 'text'),
  column('memo', label('メモ', 'Memo'), 'text'),
  column('partnerId', label('取引先', 'Partner'), 'ref', { ref: 'partner' }),
  column('debit', label('借方', 'Debit'), 'decimal'),
  column('credit', label('貸方', 'Credit'), 'decimal'),
  column('balance', label('残高', 'Balance'), 'decimal'),
  column('entryId', label('仕訳', 'Entry'), 'ref', { ref: JournalEntry.name }),
];

async function openingBalance(ctx: Context, accountId: string, from: string): Promise<Decimal> {
  const rows = await repo(ctx, JournalLine).aggregate({ where: { accountId, posted: true, entryDate: { $lt: from } }, metrics: { debit: { sum: 'debit' }, credit: { sum: 'credit' } } });
  const r = rows[0];
  if (!r) return Decimal.zero();
  return (r.debit as Decimal).minus(r.credit as Decimal);
}

async function loadHeads(ctx: Context, ids: readonly string[]): Promise<Map<string, HeadInfo>> {
  const out = new Map<string, HeadInfo>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 500) {
    const page = await repo(ctx, JournalEntry).list({ where: { id: { $in: unique.slice(i, i + 500) } }, limit: 500 });
    for (const e of page.items) out.set(e.id, { number: e.number, description: e.description });
  }
  return out;
}

function sortKey(l: LineRow, heads: Map<string, HeadInfo>): string {
  return `${l.entryDate ?? ''}|${heads.get(l.entryId)?.number ?? ''}|${String(l.seq).padStart(6, '0')}`;
}

export const generalLedgerAction = defineAction({
  name: 'accounting.general_ledger',
  description: label(
    '総勘定元帳: 指定科目の転記済み明細を日付順に、繰越残高から始まる累計残高付きで返します（残高は借方+／貸方−）。既定は当年度の期首〜今日。',
    'General ledger for one account: posted lines in date order with a running balance starting from the opening balance (debit +, credit −). Defaults: current fiscal year start .. today.',
  ),
  input: z.object({ accountId: z.uuid(), from: localDate.optional(), to: localDate.optional() }),
  output: tableResult,
  exportEntities: ['account', 'journal_entry', 'journal_line', 'fiscal_year'],
  permission: { entity: JournalLine.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: async (ctx, input) => {
    const account = await repo(ctx, Account).get(input.accountId);
    const { from, to } = await resolveReportRange(ctx, input.from, input.to);
    const opening = await openingBalance(ctx, account.id, from);
    const lines = await listAll(
      ctx,
      JournalLine,
      { where: { accountId: account.id, posted: true, $and: [{ entryDate: { $gte: from } }, { entryDate: { $lte: to } }] }, orderBy: [{ field: 'entryDate', dir: 'asc' }, { field: 'entryId', dir: 'asc' }, { field: 'seq', dir: 'asc' }] },
      MAX_REPORT_ROWS - 1,
    );
    const heads = await loadHeads(
      ctx,
      lines.items.map((l) => l.entryId),
    );
    const sorted = [...lines.items].sort((a, b) => (sortKey(a, heads) < sortKey(b, heads) ? -1 : sortKey(a, heads) > sortKey(b, heads) ? 1 : 0));
    const balances = runningBalances(opening, sorted);
    const totals = sorted.reduce((t, l) => ({ debit: t.debit.plus(l.debit), credit: t.credit.plus(l.credit) }), { debit: Decimal.zero(), credit: Decimal.zero() });
    const rows: Record<string, unknown>[] = [
      { date: from, number: null, description: '繰越', memo: null, partnerId: null, debit: null, credit: null, balance: opening.toString(), entryId: null },
      ...sorted.map((l, i) => ({
        date: l.entryDate,
        number: heads.get(l.entryId)?.number ?? null,
        description: heads.get(l.entryId)?.description ?? null,
        memo: l.memo,
        partnerId: l.partnerId,
        debit: l.debit.toString(),
        credit: l.credit.toString(),
        balance: (balances[i] ?? opening).toString(),
        entryId: l.entryId,
      })),
    ];
    const closing = balances.length > 0 ? balances[balances.length - 1] : opening;
    return {
      title: label(`総勘定元帳 ${account.code} ${account.name} ${from}〜${to}`, `General ledger ${account.code} ${account.name} ${from}..${to}`),
      columns: GENERAL_LEDGER_COLUMNS,
      rows,
      totals: { debit: totals.debit.toString(), credit: totals.credit.toString(), balance: (closing ?? opening).toString() },
      meta: { accountId: account.id, code: account.code, name: account.name, from, to, openingBalance: opening.toString(), closingBalance: (closing ?? opening).toString(), ...(lines.truncated ? { truncated: true } : {}) },
    };
  },
});
