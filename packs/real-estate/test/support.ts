// Helpers for scenario-real-estate.db.test.ts: a dated admin context per script day, action calls, journal line triples,
// payments. Everything goes through runAction / repo in a withContext transaction (no HTTP, no bypass).
import { Decimal, registry, repo, runAction, systemParams, withContext, type Context, type ContextParams } from '@daifuku/kernel';
import type { TestDb } from '@daifuku/kernel/testing';
import { Account, JournalLine } from '@daifuku/mod-accounting';

export type Row = Record<string, unknown>;
export type ListJson = { items: Row[]; total: number };
export type Table = { title: { ja: string; en: string }; columns: { key: string; kind: string }[]; rows: Row[]; totals?: Record<string, string>; meta?: Row };
export type DocJson = Row & { id: string; number: string | null; docstatus: number; status: string; journalEntryId: string | null };
export type InvoiceLineJson = Row & { seq: number; description: string; quantity: string; unitPrice: string; taxCategory: string; amount: string };
export type InvoiceJson = DocJson & { partnerId: string; date: string; dueDate: string | null; subtotal: string; taxTotal: string; total: string; paidAmount: string; balance: string; note: string | null; lines: { sales_invoice_line: InvoiceLineJson[] } };
/** [account code, debit, credit] of one posted journal line. */
export type LineTriple = [string, string, string];

/** 12:00 JST on a script date. */
export const at = (date: string): Date => new Date(`${date}T03:00:00Z`);

export function scenario(getDb: () => TestDb) {
  let codeOf = new Map<string, string>();
  const run = <T>(date: string, fn: (ctx: Context) => Promise<T>, params: Partial<ContextParams> = {}): Promise<T> => getDb().run({ now: () => at(date), ...params }, fn);
  const act = <T = Row>(date: string, name: string, input: unknown, params: Partial<ContextParams> = {}): Promise<T> => run(date, (ctx) => runAction(ctx, name, input), params) as Promise<T>;

  const createSubmit = async <T extends DocJson>(date: string, entity: string, head: Row): Promise<T> => {
    const created = await act<DocJson>(date, `${entity}.create`, head);
    await act(date, `${entity}.submit`, { id: created.id });
    return act<T>(date, `${entity}.get`, { id: created.id });
  };

  /** Every module seed in a system context, in registration order (like apps/api db:reset). Returns the seeded names. */
  const seedModules = async (date: string): Promise<string[]> => {
    const db = getDb();
    const seeded: string[] = [];
    for (const m of registry.allModules()) {
      if (!m.seed) continue;
      await withContext(db.owner, systemParams(db.tenantId, db.companyId, { now: () => at(date) }), async (ctx) => m.seed?.(ctx));
      seeded.push(m.name);
    }
    return seeded;
  };

  const loadAccounts = async (date: string): Promise<Record<string, string>> => {
    const accounts = await run(date, (ctx) => repo(ctx, Account).list({ limit: 500 }));
    codeOf = new Map(accounts.items.map((a) => [a.id, a.code]));
    return Object.fromEntries(accounts.items.map((a) => [a.code, a.id]));
  };

  /** Posted lines of an entry as [code, debit, credit] in seq order. */
  const entryLines = async (entryId: string | null): Promise<LineTriple[]> => {
    if (!entryId) return [];
    const lines = await run('2026-12-31', (ctx) => repo(ctx, JournalLine).list({ where: { entryId }, orderBy: [{ field: 'seq', dir: 'asc' }], limit: 100 }));
    return lines.items.map((l): LineTriple => [codeOf.get(l.accountId) ?? l.accountId, l.debit.toString(), l.credit.toString()]);
  };

  /** 入金: one receipt fully allocated to one invoice, into 普通預金 (payment.accounts.bank). */
  const receive = (date: string, partnerId: string, invoiceId: string, amount: string) =>
    createSubmit<DocJson & { amount: string; allocatedAmount: string; accountId: string }>(date, 'payment', {
      direction: 'receive',
      partnerId,
      date,
      amount,
      method: 'bank_transfer',
      lines: { payment_allocation: [{ invoiceEntity: 'sales_invoice', invoiceId, amount }] },
    });

  return { run, act, createSubmit, seedModules, loadAccounts, entryLines, receive };
}

export const sum = (values: readonly string[]): string => Decimal.sum(values.map((v) => Decimal.from(v))).toString();

export const caught = (p: Promise<unknown>): Promise<unknown> => p.then(
  () => null,
  (e: unknown) => e,
);
