// accounting.import_opening_balances / reverse_opening_balances / opening_balance_status
// (docs/specs/opening-balances.md AC-2, AC-5, AC-9..AC-14, AC-25..AC-29, ADR-0030). The opening journal is one entry
// dated the day before the company's first fiscal year, linked to the year by sourceEntity/sourceId; partner-less rows of
// partner-required accounts (receivables/payables totals) go to the opening balance clearing account, which the opening
// invoices of sales/purchase clear per partner. Corrections are reversal + re-import, never edits.
import {
  Conflict,
  Decimal,
  defineAction,
  DOCSTATUS,
  label,
  NotFound,
  repo,
  StateError,
  ValidationError,
  withLock,
  type Context,
  type Infer,
} from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { z } from 'zod';
import { Account } from '../entities/account.ts';
import { FiscalYear } from '../entities/fiscal-year.ts';
import { JournalEntry } from '../entities/journal-entry.ts';
import { JournalLine } from '../entities/journal-line.ts';
import {
  assertOpeningCurrency,
  assertOpeningInputSize,
  attempt,
  clearingAccountState,
  clearingBalanceAt,
  clearingUsedNotice,
  foreignClearingPostings,
  lookupByCode,
  openingCell,
  openingImportResult,
  openingMode,
  openingYearJson,
  OPENING_INPUT_BYTES,
  OPENING_ROLES,
  postOpeningFromSource,
  resolveOpeningClearingAccount,
  reverseOpeningSourceEntry,
  rowResult,
  runOpeningImport,
  type OpeningImportResult,
} from '../opening.ts';
import { assertOpeningYear, openingYearProblem } from '../opening-year.ts';
import {
  accountRowIssue,
  classifyJournalAmounts,
  clearingMemo,
  isMessage,
  journalIssues,
  journalTotals,
  openingDateOf,
  readCode,
  summarize,
  type OpeningMessage,
  type OpeningRowResult,
} from '../services/opening.ts';
import { liveEntriesForSource } from './post-from-source.ts';
import { localDate } from './helpers.ts';

/** AC-9: rows per request; AC-11: lines of the one opening entry (the journal line limit). */
export const OPENING_JOURNAL_MAX_ROWS = 1000;
export const OPENING_JOURNAL_MAX_LINES = 500;
export const OPENING_SOURCE = FiscalYear.name;

type AccountRow = Infer<typeof Account>;

export const importOpeningBalancesInput = z
  .object({
    fiscalYearId: z.uuid(),
    mode: openingMode,
    rows: z
      .array(
        z
          .object({
            accountCode: openingCell,
            partnerCode: openingCell,
            debit: openingCell,
            credit: openingCell,
            memo: openingCell,
          })
          .strict(),
      )
      .min(1)
      .max(OPENING_JOURNAL_MAX_ROWS),
  })
  .strict();
export type ImportOpeningBalancesInput = z.output<typeof importOpeningBalancesInput>;

interface PlannedLine {
  line: number;
  accountId: string;
  partnerId: string | null;
  side: 'debit' | 'credit';
  amount: Decimal;
  memo: string | null;
  clearingFrom: AccountRow | null;
}

function sourceConflict(year: { id: string; code: string }, existing: { id: string; number: string | null }): Conflict {
  return new Conflict(
    `${year.code} already has an opening journal ${existing.number ?? existing.id}`,
    'Reverse it with accounting.reverse_opening_balances, then import again.',
    { reason: 'opening_entry_exists', fiscalYearId: year.id, entryId: existing.id, number: existing.number },
  );
}

/** AC-9 / AC-10: per-row classification and the substitution of partner-less partner-required rows. */
async function planRows(
  ctx: Context,
  input: ImportOpeningBalancesInput,
  clearing: AccountRow,
): Promise<{ rows: OpeningRowResult[]; lines: PlannedLine[]; notices: OpeningMessage[] }> {
  const codes = input.rows.map((r) => ({
    account: readCode('accountCode', r.accountCode),
    partner: readCode('partnerCode', r.partnerCode),
  }));
  const text = (v: unknown): v is string => typeof v === 'string';
  const accounts = await lookupByCode(ctx, Account, 'accountCode', codes.map((c) => c.account).filter(text));
  const partners = await lookupByCode(ctx, Partner, 'partnerCode', codes.map((c) => c.partner).filter(text), {
    byName: true,
  });
  const rows: OpeningRowResult[] = [];
  const lines: PlannedLine[] = [];
  const journalOnly: number[] = [];
  for (const [index, raw] of input.rows.entries()) {
    const line = index + 1;
    const amount = classifyJournalAmounts(raw);
    if (amount.status !== 'ok') {
      rows.push(rowResult(line, amount.status, amount.messages));
      continue;
    }
    const { account: accountCell, partner: partnerCell } = codes[index] ?? {};
    if (isMessage(accountCell) || isMessage(partnerCell)) {
      rows.push(rowResult(line, 'error', [accountCell, partnerCell].filter(isMessage)));
      continue;
    }
    if (accountCell === undefined) {
      rows.push(
        rowResult(line, 'error', [
          { code: 'ref_not_found', message: 'accountCode is blank', field: 'accountCode', column: 'accountCode' },
        ]),
      );
      continue;
    }
    const found = accounts.get(accountCell);
    if (!found?.ok) {
      rows.push(rowResult(line, 'error', found ? [found.message] : []));
      continue;
    }
    const account = found.row;
    const issue = accountRowIssue(account, clearing.id);
    if (issue) {
      rows.push(rowResult(line, 'error', [issue]));
      continue;
    }
    let partnerId: string | null = null;
    if (partnerCell !== undefined) {
      const partner = partners.get(partnerCell);
      if (!partner?.ok) {
        rows.push(rowResult(line, 'error', partner ? [partner.message] : []));
        continue;
      }
      partnerId = partner.row.id;
    }
    const memo = typeof raw.memo === 'string' && raw.memo.trim() !== '' ? raw.memo.trim().slice(0, 200) : null;
    if (account.partnerRequired && partnerId === null) {
      lines.push({
        line,
        accountId: clearing.id,
        partnerId: null,
        side: amount.side,
        amount: amount.amount,
        memo: clearingMemo(account, memo),
        clearingFrom: account,
      });
      rows.push(rowResult(line, 'clearing'));
      continue;
    }
    lines.push({
      line,
      accountId: account.id,
      partnerId,
      side: amount.side,
      amount: amount.amount,
      memo,
      clearingFrom: null,
    });
    if (account.partnerRequired) {
      journalOnly.push(line);
      rows.push(
        rowResult(line, 'ok', [
          {
            code: 'journal_only_open_item',
            message: `${account.code} ${account.name}: this balance is posted with the partner but is not an open item for allocation or aging`,
            hint: 'Leave the partner blank and import the balance per partner as opening invoices instead.',
          },
        ]),
      );
    } else rows.push(rowResult(line, 'ok'));
  }
  const notices: OpeningMessage[] = journalOnly.length
    ? [
        {
          code: 'journal_only_open_item',
          message: `rows ${journalOnly.join(', ')} post receivable/payable-type balances with a partner; they are not open items for allocation or aging`,
        },
      ]
    : [];
  return { rows, lines, notices };
}

/** AC-10: the original accounts moved to the clearing account, with their amounts. */
function clearingAccountsOf(lines: readonly PlannedLine[]): NonNullable<OpeningImportResult['clearingAccounts']> {
  const by = new Map<string, { code: string; name: string; debit: Decimal; credit: Decimal }>();
  for (const l of lines) {
    if (!l.clearingFrom) continue;
    const cur = by.get(l.clearingFrom.id) ?? {
      code: l.clearingFrom.code,
      name: l.clearingFrom.name,
      debit: Decimal.zero(),
      credit: Decimal.zero(),
    };
    if (l.side === 'debit') cur.debit = cur.debit.plus(l.amount);
    else cur.credit = cur.credit.plus(l.amount);
    by.set(l.clearingFrom.id, cur);
  }
  return [...by.values()].map((v) => ({
    code: v.code,
    name: v.name,
    debit: v.debit.toString(),
    credit: v.credit.toString(),
  }));
}

export async function importOpeningBalances(
  ctx: Context,
  input: ImportOpeningBalancesInput,
): Promise<OpeningImportResult> {
  assertOpeningInputSize(input);
  await assertOpeningCurrency(ctx);
  const year = await assertOpeningYear(ctx, input.fiscalYearId);
  const clearing = await resolveOpeningClearingAccount(ctx);
  // D-14: the source lock is taken before the duplicate check, so a concurrent import waits here and then gets 409.
  await withLock(ctx, `accounting-source:${OPENING_SOURCE}:${year.fiscalYear.id}`, async () => undefined);
  const live = (await liveEntriesForSource(ctx, OPENING_SOURCE, year.fiscalYear.id))[0];
  if (live) throw sourceConflict(year.fiscalYear, live);
  const planned = await planRows(ctx, input, clearing);
  if (planned.lines.length > OPENING_JOURNAL_MAX_LINES)
    throw new ValidationError(
      `the opening journal would have ${planned.lines.length} lines`,
      [{ path: 'rows', message: `at most ${OPENING_JOURNAL_MAX_LINES} accepted rows (journal line limit)` }],
      'Combine rows of the same account and partner, or put sub-accounts together.',
    );
  const totals = journalTotals(planned.lines);
  const issues = journalIssues(planned.lines);
  const errors = planned.rows.some((r) => r.status === 'error');
  const before = await clearingBalanceAt(ctx, clearing.id, year.openingDate);
  const foreign = await foreignClearingPostings(ctx, clearing.id, year.openingDate);
  const notices = [...planned.notices, ...(foreign > 0 ? [clearingUsedNotice(foreign)] : [])];
  const { committed, value } = await runOpeningImport(ctx, input.mode, async (scope) => {
    if (errors || issues.length > 0) return { failed: true, issues, after: before, document: null };
    const posted = await attempt(scope, (sp) =>
      postOpeningFromSource(sp, {
        sourceEntity: OPENING_SOURCE,
        sourceId: year.fiscalYear.id,
        date: year.openingDate,
        description: `期首残高 ${year.fiscalYear.code}`,
        lines: planned.lines.map((l) => ({
          accountId: l.accountId,
          partnerId: l.partnerId,
          ...(l.side === 'debit' ? { debit: l.amount } : { credit: l.amount }),
          memo: l.memo,
        })),
      }),
    );
    if (!posted.ok)
      return {
        failed: true,
        issues: posted.messages.map((m) => ({ ...m, code: 'submit_failed', message: `${m.code}: ${m.message}` })),
        after: before,
        document: null,
      };
    return {
      failed: false,
      issues: [],
      after: await clearingBalanceAt(scope, clearing.id, year.openingDate),
      document: { entity: JournalEntry.name, id: posted.value.id, number: posted.value.number },
    };
  });
  return {
    mode: input.mode,
    committed,
    ...openingYearJson(year),
    summary: summarize(planned.rows),
    totals: {
      debit: totals.debit.toString(),
      credit: totals.credit.toString(),
      difference: totals.difference.toString(),
    },
    clearingBalance: { before: before.toString(), after: value.after.toString() },
    clearingAccounts: clearingAccountsOf(planned.lines),
    issues: value.issues,
    notices,
    rows: planned.rows,
    documents: committed && value.document ? [value.document] : [],
  };
}

export const importOpeningBalancesAction = defineAction({
  name: 'accounting.import_opening_balances',
  description: label(
    '期首残高の開始仕訳を取り込みます（行: accountCode, partnerCode?, debit?, credit?, memo?。最大 1,000 行・2 MB）。日付は会社の最初の会計年度の期首日の前日。取引先なしの売掛金・買掛金など取引先必須の科目の行は期首残高仮勘定へ計上します。mode: dry-run は確認だけで何も書きません。全件か無かで、未取消の開始仕訳があれば CONFLICT。',
    'Import the opening journal (rows: accountCode, partnerCode?, debit?, credit?, memo?; at most 1,000 rows / 2 MB), dated the day before the company’s first fiscal year. Rows of partner-required accounts without a partner (receivable/payable totals) post to the opening balance clearing account. mode dry-run checks without writing. All or nothing; CONFLICT when an unreversed opening journal exists.',
  ),
  input: importOpeningBalancesInput,
  output: openingImportResult,
  permission: { roles: OPENING_ROLES },
  inputBytes: OPENING_INPUT_BYTES,
  handler: (ctx, input) => importOpeningBalances(ctx, input),
});

// ---- reversal (AC-14) ----------------------------------------------------------------------------------

export const reverseOpeningBalancesAction = defineAction({
  name: 'accounting.reverse_opening_balances',
  description: label(
    '会計年度の未取消の開始仕訳を、期首残高日付の逆仕訳で取り消します（取り込み直す前に使う）。期首請求書と期首在庫の入庫は取り消しません。',
    'Reverse the unreversed opening journal of the fiscal year with a reversing entry dated the opening date (before importing again). Opening invoices and opening stock receipts are not cancelled.',
  ),
  input: z.object({ fiscalYearId: z.uuid() }).strict(),
  output: z.object({
    fiscalYearId: z.uuid(),
    openingDate: localDate,
    entry: z.object({ id: z.uuid(), number: z.string().nullable() }),
    reversal: z.object({ id: z.uuid(), number: z.string().nullable() }),
  }),
  permission: { roles: OPENING_ROLES },
  handler: async (ctx, input) => {
    const year = await assertOpeningYear(ctx, input.fiscalYearId);
    await withLock(ctx, `accounting-source:${OPENING_SOURCE}:${year.fiscalYear.id}`, async () => undefined);
    const live = (await liveEntriesForSource(ctx, OPENING_SOURCE, year.fiscalYear.id))[0];
    if (!live)
      throw new StateError(
        `${year.fiscalYear.code} has no unreversed opening journal`,
        'Import the opening journal first (accounting.import_opening_balances).',
        { reason: 'no_opening_entry', fiscalYearId: year.fiscalYear.id },
      );
    const reversal = await reverseOpeningSourceEntry(ctx, {
      id: live.id,
      sourceEntity: OPENING_SOURCE,
      sourceId: year.fiscalYear.id,
    });
    return {
      fiscalYearId: year.fiscalYear.id,
      openingDate: year.openingDate,
      entry: { id: live.id, number: live.number },
      reversal: { id: reversal.id, number: reversal.number },
    };
  },
});

// ---- status (AC-29) ------------------------------------------------------------------------------------

const yearStatus = z.object({
  id: z.uuid(),
  code: z.string(),
  startDate: localDate,
  endDate: localDate,
  openingDate: localDate,
  importable: z.boolean(),
  reason: z.string().nullable(),
});

export const openingBalanceStatusOutput = z.object({
  years: z.array(yearStatus),
  selected: yearStatus.extend({
    entry: z.object({ id: z.uuid(), number: z.string().nullable(), debit: z.string(), credit: z.string() }).nullable(),
    reversedCount: z.number().int(),
  }),
  clearing: z.object({
    ok: z.boolean(),
    code: z.string(),
    name: z.string().nullable(),
    reason: z.string().nullable(),
    message: z.string().nullable(),
    balance: z.string().nullable(),
    foreignPostings: z.number().int(),
    lines: z.array(z.object({ memo: z.string().nullable(), debit: z.string(), credit: z.string() })),
  }),
});
export type OpeningBalanceStatus = z.output<typeof openingBalanceStatusOutput>;

export async function openingBalanceStatus(
  ctx: Context,
  input: { fiscalYearId?: string | undefined },
): Promise<OpeningBalanceStatus> {
  const list = await repo(ctx, FiscalYear).list({ orderBy: [{ field: 'startDate', dir: 'asc' }], limit: 100 });
  if (list.items.length === 0)
    throw new StateError('The company has no fiscal year yet', 'Open one with accounting.open_fiscal_year first.', {
      reason: 'no_fiscal_year',
    });
  const years = [];
  for (const y of list.items) {
    const problem = await openingYearProblem(ctx, y);
    years.push({
      id: y.id,
      code: y.code,
      startDate: y.startDate,
      endDate: y.endDate,
      openingDate: openingDateOf(y.startDate),
      importable: problem.reason === null,
      reason: problem.reason,
    });
  }
  const selectedYear = input.fiscalYearId ? years.find((y) => y.id === input.fiscalYearId) : years[0];
  if (!selectedYear) throw new NotFound(FiscalYear.name, input.fiscalYearId ?? '');
  const posted = await repo(ctx, JournalEntry).list({
    where: { sourceEntity: OPENING_SOURCE, sourceId: selectedYear.id, docstatus: DOCSTATUS.submitted },
    limit: 500,
  });
  const live = await liveEntriesForSource(ctx, OPENING_SOURCE, selectedYear.id);
  const liveEntry = live[0] ? posted.items.find((e) => e.id === live[0]?.id) : undefined;
  const state = await clearingAccountState(ctx);
  const account = state.ok ? state.account : (state.account ?? null);
  const clearingLines =
    account && liveEntry
      ? (
          await repo(ctx, JournalLine).list({
            where: { entryId: liveEntry.id, accountId: account.id },
            orderBy: [{ field: 'seq', dir: 'asc' }],
            limit: 500,
          })
        ).items.map((l) => ({ memo: l.memo, debit: l.debit.toString(), credit: l.credit.toString() }))
      : [];
  return {
    years,
    selected: {
      ...selectedYear,
      entry: liveEntry
        ? {
            id: liveEntry.id,
            number: liveEntry.number,
            debit: liveEntry.totalDebit.toString(),
            credit: liveEntry.totalCredit.toString(),
          }
        : null,
      reversedCount: posted.items.length - live.length,
    },
    clearing: {
      ok: state.ok,
      code: state.code,
      name: account?.name ?? null,
      reason: state.ok ? null : state.reason,
      message: state.ok ? null : state.message,
      balance: account ? (await clearingBalanceAt(ctx, account.id, selectedYear.openingDate)).toString() : null,
      foreignPostings: account ? await foreignClearingPostings(ctx, account.id, selectedYear.openingDate) : 0,
      lines: clearingLines,
    },
  };
}

export const openingBalanceStatusAction = defineAction({
  name: 'accounting.opening_balance_status',
  description: label(
    '期首残高の取込の状況: 会計年度ごとの期首残高日と取込できるか、選んだ年度（省略時は最初の年度）の開始仕訳と、期首残高仮勘定の残高。',
    'Opening balance status: per fiscal year the opening date and whether it can take opening balances; for the chosen year (default: the first) its opening journal and the clearing account balance.',
  ),
  input: z.object({ fiscalYearId: z.uuid().optional() }).strict(),
  output: openingBalanceStatusOutput,
  permission: { roles: OPENING_ROLES },
  tx: 'none',
  mutates: false,
  handler: (ctx, input) => openingBalanceStatus(ctx, input),
});
