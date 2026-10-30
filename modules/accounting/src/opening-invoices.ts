// The receivable / payable halves of the opening balance import (docs/specs/opening-balances.md AC-15..AC-18, AC-25..
// AC-27, D-4, D-14). Shared by sales.import_opening_receivables and purchase.import_opening_payables: accounting owns the
// request checks, the row parsing, the duplicate rule and the all-or-nothing run; the owning module creates and submits
// its own invoice through `create` (accounting does not depend on sales/purchase).
import {
  Decimal,
  DOCSTATUS,
  repo,
  withLock,
  type Context,
  type EntityDef,
  type Infer,
  type LocalDate,
  type Op,
} from '@daifuku/kernel';
import { computeDueDate, Partner } from '@daifuku/mod-partner';
import { z } from 'zod';
import type { Account } from './entities/account.ts';
import { JournalEntry } from './entities/journal-entry.ts';
import { JournalLine } from './entities/journal-line.ts';
import {
  assertOpeningCurrency,
  assertOpeningOps,
  attempt,
  clearingBalanceAt,
  clearingUsedNotice,
  foreignClearingPostings,
  lookupByCode,
  openingCell,
  openingMode,
  openingYearJson,
  resolveOpeningClearingAccount,
  rowResult,
  runOpeningImport,
  type OpeningDocument,
  type OpeningImportResult,
} from './opening.ts';
import { assertOpeningYear, type OpeningYear } from './opening-year.ts';
import {
  fieldMessage,
  isMessage,
  readCode,
  readDate,
  readOpeningAmount,
  summarize,
  type OpeningMessage,
  type OpeningRowResult,
} from './services/opening.ts';

/** AC-15: rows (= opening invoices) per request. */
export const OPENING_INVOICE_MAX_ROWS = 1000;

export const openingInvoicesInput = z
  .object({
    fiscalYearId: z.uuid(),
    mode: openingMode,
    rows: z
      .array(
        z
          .object({
            partnerCode: openingCell,
            amount: openingCell,
            dueDate: openingCell,
            reference: openingCell,
            originalDate: openingCell,
            memo: openingCell,
          })
          .strict(),
      )
      .min(1)
      .max(OPENING_INVOICE_MAX_ROWS),
  })
  .strict();
export type OpeningInvoicesInput = z.output<typeof openingInvoicesInput>;

type PartnerRow = Infer<typeof Partner>;
type AccountRow = Infer<typeof Account>;

/** One accepted row, ready for the owning module to turn into an invoice. */
export interface OpeningInvoiceRow {
  line: number;
  partner: PartnerRow;
  amount: Decimal;
  dueDate: LocalDate;
  reference: string | null;
  originalDate: LocalDate | null;
  memo: string | null;
}

export interface OpeningInvoiceSpec {
  /** Action name, for the 403 of AC-6. */
  action: string;
  invoice: EntityDef;
  /** AC-6: the invoice/line ops the caller must hold (journal_entry create/submit and partner read are added). */
  needs: readonly [EntityDef, Op][];
  /** D-16: request-level check of the module's posting accounts (sales.accounts / purchase.accounts). */
  checkPostingAccounts: (ctx: Context) => Promise<unknown>;
  /** Creates and submits one opening invoice in the caller's context (module write for `openingBalance`). */
  create: (
    ctx: Context,
    row: OpeningInvoiceRow,
    year: OpeningYear,
    clearing: AccountRow,
  ) => Promise<{ id: string; number: string | null }>;
}

const PAGE = 200;

/**
 * AC-18 (D-8): partners that may not get another opening invoice of this kind — one is live (`exists`), or one was
 * cancelled on a date other than the opening date (`cancelled_in_year`: its in-year reversal stays in the ledger).
 */
async function blockedPartners(
  ctx: Context,
  invoice: EntityDef,
  partnerIds: readonly string[],
  openingDate: LocalDate,
): Promise<Map<string, OpeningMessage>> {
  const out = new Map<string, OpeningMessage>();
  const unique = [...new Set(partnerIds)];
  for (let i = 0; i < unique.length; i += PAGE) {
    const chunk = unique.slice(i, i + PAGE);
    for (let offset = 0; ;) {
      const page = await repo(ctx, invoice).list({
        where: {
          openingBalance: true,
          date: openingDate,
          partnerId: { $in: chunk },
          docstatus: { $in: [DOCSTATUS.submitted, DOCSTATUS.cancelled] },
        },
        limit: 500,
        offset,
      });
      for (const raw of page.items as Record<string, unknown>[]) {
        const partnerId = String(raw.partnerId);
        const number = String(raw.number ?? raw.id);
        if (raw.docstatus === DOCSTATUS.submitted)
          out.set(
            partnerId,
            fieldMessage(
              'partnerCode',
              'exists',
              `the partner already has opening invoice ${number}`,
              'Cancel it (on the opening date) before importing the partner again, or leave the row out.',
            ),
          );
        else if (raw.cancelledDate !== openingDate && !out.has(partnerId))
          out.set(
            partnerId,
            fieldMessage(
              'partnerCode',
              'cancelled_in_year',
              `opening invoice ${number} of the partner was cancelled on ${String(raw.cancelledDate)}, after the opening date`,
              'Its in-year reversal stays in the ledger: correct the balance with an ordinary in-year invoice or journal instead.',
            ),
          );
      }
      offset += page.items.length;
      if (page.items.length === 0 || offset >= page.total) break;
    }
  }
  return out;
}

function noteOf(row: { reference: string | null; originalDate: LocalDate | null; memo: string | null }): string {
  const ref = row.reference ? ` 元請求書 ${row.reference}` : '';
  const date = row.originalDate ? `（${row.originalDate}）` : '';
  return `期首残高${ref}${date}${row.memo ? ` ${row.memo}` : ''}`.slice(0, 2000);
}

/** The note an opening invoice carries (AC-16). Exported for the owning modules and tests. */
export const openingInvoiceNote = noteOf;

type Parsed = { ok: true; row: OpeningInvoiceRow } | { ok: false; line: number; messages: OpeningMessage[] };

function parseRow(
  raw: OpeningInvoicesInput['rows'][number],
  line: number,
  partner: { ok: true; row: PartnerRow } | { ok: false; message: OpeningMessage } | undefined,
  blocked: Map<string, OpeningMessage>,
  openingDate: LocalDate,
): Parsed {
  const messages: OpeningMessage[] = [];
  const code = readCode('partnerCode', raw.partnerCode);
  const amount = readOpeningAmount('amount', raw.amount);
  const dueDate = readDate('dueDate', raw.dueDate);
  const originalDate = readDate('originalDate', raw.originalDate);
  for (const v of [code, amount, dueDate, originalDate]) if (isMessage(v)) messages.push(v);
  if (code === undefined)
    messages.push(fieldMessage('partnerCode', 'ref_not_found', 'partnerCode is blank', 'Write the partner code.'));
  else if (!isMessage(code) && partner && !partner.ok) messages.push(partner.message);
  if (typeof originalDate === 'string' && originalDate > openingDate)
    messages.push(
      fieldMessage('originalDate', 'invalid_value', `${originalDate} is after the opening date ${openingDate}`),
    );
  if (typeof originalDate === 'string' && typeof dueDate === 'string' && dueDate < originalDate)
    messages.push(fieldMessage('dueDate', 'invalid_value', `the due date ${dueDate} is before ${originalDate}`));
  const p = partner?.ok ? partner.row : null;
  if (p && messages.length === 0) {
    const block = blocked.get(p.id);
    if (block) messages.push(block);
  }
  if (messages.length > 0 || !p || isMessage(amount)) return { ok: false, line, messages };
  const base = typeof originalDate === 'string' ? originalDate : openingDate;
  const reference = typeof raw.reference === 'string' && raw.reference.trim() ? raw.reference.trim() : null;
  const memo = typeof raw.memo === 'string' && raw.memo.trim() ? raw.memo.trim() : null;
  return {
    ok: true,
    row: {
      line,
      partner: p,
      amount,
      // D-18: an empty due date follows the partner's terms from the original date, else from the opening date.
      dueDate:
        typeof dueDate === 'string' ? dueDate : computeDueDate(base, p.closingDay, p.paymentMonthOffset, p.paymentDay),
      reference,
      originalDate: typeof originalDate === 'string' ? originalDate : null,
      memo,
    },
  };
}

export async function importOpeningInvoices(
  ctx: Context,
  input: OpeningInvoicesInput,
  spec: OpeningInvoiceSpec,
): Promise<OpeningImportResult> {
  await assertOpeningCurrency(ctx);
  const year = await assertOpeningYear(ctx, input.fiscalYearId);
  assertOpeningOps(ctx, spec.action, [
    ...spec.needs,
    [Partner, 'read'],
    [JournalEntry, 'create'],
    [JournalEntry, 'submit'],
    [JournalLine, 'create'],
  ]);
  const clearing = await resolveOpeningClearingAccount(ctx);
  await spec.checkPostingAccounts(ctx);
  // D-14: the per-year lock is taken before the duplicate query, so concurrent imports cannot both pass it.
  await withLock(ctx, `opening:${spec.invoice.name}:${year.fiscalYear.id}`, async () => undefined);
  const codes = input.rows.map((r) => readCode('partnerCode', r.partnerCode));
  const partners = await lookupByCode(
    ctx,
    Partner,
    'partnerCode',
    codes.filter((c): c is string => typeof c === 'string'),
    { byName: true },
  );
  const partnerIds = [...partners.values()].flatMap((p) => (p.ok ? [p.row.id] : []));
  const blocked = await blockedPartners(ctx, spec.invoice, partnerIds, year.openingDate);
  const parsed = input.rows.map((raw, index) => {
    const code = codes[index];
    return parseRow(
      raw,
      index + 1,
      typeof code === 'string' ? partners.get(code) : undefined,
      blocked,
      year.openingDate,
    );
  });
  const before = await clearingBalanceAt(ctx, clearing.id, year.openingDate);
  const foreign = await foreignClearingPostings(ctx, clearing.id, year.openingDate);
  const { committed, value } = await runOpeningImport(ctx, input.mode, async (scope) => {
    const rows: OpeningRowResult[] = [];
    const documents: OpeningDocument[] = [];
    for (const p of parsed) {
      if (!p.ok) {
        rows.push(rowResult(p.line, 'error', p.messages));
        continue;
      }
      const created = await attempt(scope, (sp) => spec.create(sp, p.row, year, clearing));
      if (created.ok) {
        rows.push(rowResult(p.row.line, 'ok'));
        documents.push({ entity: spec.invoice.name, id: created.value.id, number: created.value.number });
      } else rows.push(rowResult(p.row.line, 'error', created.messages));
    }
    return {
      failed: rows.some((r) => r.status === 'error'),
      rows,
      documents,
      after: await clearingBalanceAt(scope, clearing.id, year.openingDate),
    };
  });
  const amount = Decimal.sum(parsed.flatMap((p) => (p.ok ? [p.row.amount] : [])));
  return {
    mode: input.mode,
    committed,
    ...openingYearJson(year),
    summary: summarize(value.rows),
    totals: { amount: amount.toString() },
    clearingBalance: { before: before.toString(), after: value.after.toString() },
    issues: [],
    notices: foreign > 0 ? [clearingUsedNotice(foreign)] : [],
    rows: value.rows,
    documents: committed ? value.documents : [],
  };
}
