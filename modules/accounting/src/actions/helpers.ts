// Shared pieces of the accounting actions: input scalars, paginated reads, create+submit of an entry with lines.
import { Decimal, isDecimal, isLocalDate, repo, saveLines, snapshot, submitDocument, todayLocal, type Context, type EntityDef, type Infer, type InsertInput, type ListQuery, type LocalDate } from '@daifuku/kernel';
import { z } from 'zod';
import { FiscalYear } from '../entities/fiscal-year.ts';
import { JournalEntry } from '../entities/journal-entry.ts';
import { JournalLine } from '../entities/journal-line.ts';
import { TAX_CATEGORIES } from '../entities/account.ts';
import { loadLines } from '../hooks/validate-entry.ts';

export const localDate = z.string().refine(isLocalDate, 'must be YYYY-MM-DD');

/** JSON callers send decimal strings; in-process callers may pass Decimal (the kernel's insert schema accepts both). */
export const decimalInput = z.union([z.string().refine(Decimal.isDecimalString, 'must be a decimal string'), z.custom<Decimal>(isDecimal, 'expected Decimal')]);

export const lineInput = z.object({
  accountId: z.uuid(),
  debit: decimalInput.optional(),
  credit: decimalInput.optional(),
  partnerId: z.uuid().nullable().optional(),
  taxCategory: z.enum(TAX_CATEGORIES).nullable().optional(),
  taxRate: decimalInput.nullable().optional(),
  memo: z.string().max(200).nullable().optional(),
  ext: z.record(z.string(), z.unknown()).optional(),
});
export type LineInput = z.input<typeof lineInput>;

export type JournalEntryRow = Infer<typeof JournalEntry>;
export type JournalLineRow = Infer<typeof JournalLine>;
export interface EntryWithLines extends JournalEntryRow {
  lines: JournalLineRow[];
}

export const entryWithLinesJson = JournalEntry.schemas.json.extend({ lines: z.array(JournalLine.schemas.json) });

/** JSON-safe copy of a domain row (Decimal -> string, Date -> ISO) for action outputs. */
export function json(row: object): Record<string, unknown> {
  return snapshot(row as Record<string, unknown>);
}

export function toEntryJson(e: EntryWithLines): Record<string, unknown> {
  const { lines, ...head } = e;
  return { ...json(head), lines: lines.map((l) => json(l)) };
}

/** Reads every visible row of a query, page by page, up to `max` (repo.list caps a page at 500). */
export async function listAll<E extends EntityDef>(ctx: Context, entity: E, query: Omit<ListQuery, 'limit' | 'offset'>, max: number): Promise<{ items: Infer<E>[]; truncated: boolean }> {
  const items: Infer<E>[] = [];
  let offset = 0;
  for (;;) {
    const page = await repo(ctx, entity).list({ ...query, limit: 500, offset });
    items.push(...page.items);
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) return { items, truncated: false };
    if (items.length >= max) return { items: items.slice(0, max), truncated: true };
  }
}

/** Creates a draft with lines and submits it in the caller's transaction: all or nothing (spec AC-7). */
export async function createAndSubmitEntry(ctx: Context, head: InsertInput<typeof JournalEntry>, lines: readonly LineInput[]): Promise<EntryWithLines> {
  const draft = await repo(ctx, JournalEntry).create(head);
  await saveLines(ctx, JournalEntry, draft.id, { [JournalLine.name]: lines.map((l) => ({ ...l })) });
  const submitted = await submitDocument(ctx, JournalEntry, draft.id);
  return { ...submitted, lines: await loadLines(ctx, draft.id) };
}

export async function loadEntryWithLines(ctx: Context, id: string): Promise<EntryWithLines> {
  const entry = await repo(ctx, JournalEntry).get(id);
  return { ...entry, lines: await loadLines(ctx, id) };
}

export interface ReportRange {
  from: LocalDate;
  to: LocalDate;
}

/** Defaults for report inputs: `to` = today (JST), `from` = start of the fiscal year containing `to` (else Jan 1). */
export async function resolveReportRange(ctx: Context, from: LocalDate | undefined, to: LocalDate | undefined): Promise<ReportRange> {
  const end = to ?? todayLocal(ctx.now());
  if (from) return { from, to: end };
  const years = await repo(ctx, FiscalYear).list({ where: { $and: [{ startDate: { $lte: end } }, { endDate: { $gte: end } }] }, limit: 1 });
  return { from: years.items[0]?.startDate ?? `${end.slice(0, 4)}-01-01`, to: end };
}
