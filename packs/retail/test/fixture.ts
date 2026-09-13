// Shared helpers for the retail scenario test (DB daifuku_test_retail via TEST_DATABASE_URL*). Importing ../src/index.ts
// registers the modules the pack depends on and the pack itself, so freshDb builds every table from the registry.
// Seeds run like apps/api/src/db/reset.ts: module order, system context on the owner connection.
import {
  Decimal,
  registerCrudActions,
  registerPackActions,
  repo,
  runAction,
  systemParams,
  withContext,
  type Context,
  type ContextParams,
  type ModuleDef,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { JapanModule } from '@daifuku/l10n-jp';
import { AccountingModule, JournalLine } from '@daifuku/mod-accounting';
import { InventoryModule } from '@daifuku/mod-inventory';
import { PartnerModule } from '@daifuku/mod-partner';
import { PaymentModule } from '@daifuku/mod-payment';
import { ProductModule } from '@daifuku/mod-product';
import { PurchaseModule } from '@daifuku/mod-purchase';
import { SalesModule } from '@daifuku/mod-sales';
import { TaxModule } from '@daifuku/mod-tax';
import { RetailPack } from '../src/index.ts';

export type Row = Record<string, unknown>;
export type ListJson = { items: Row[]; total: number };
export type Table = {
  title: { ja: string; en: string };
  columns: { key: string; kind: string; label: { ja: string; en: string } }[];
  rows: Row[];
  totals?: Record<string, string>;
  meta?: Row;
};
export type DocJson = Row & { id: string; number: string | null; docstatus: number };
/** [account code, debit, credit] of one journal line. */
export type LineTriple = [string, string, string];

/** 2026-11-30 12:00 JST — "today" for every default (the script's cut-off date). */
export const FIXED_NOW = new Date('2026-11-30T03:00:00Z');

/** Module order of apps/api/src/modules.ts for the modules this pack uses (seed order matters: l10n/jp last). */
export const MODULES: readonly ModuleDef[] = [
  PartnerModule,
  ProductModule,
  TaxModule,
  AccountingModule,
  SalesModule,
  PurchaseModule,
  PaymentModule,
  InventoryModule,
  JapanModule,
];

export interface Scenario {
  db: TestDb;
  run<T>(fn: (ctx: Context) => Promise<T>, params?: Partial<ContextParams>): Promise<T>;
  act<T = Row>(name: string, input: unknown, params?: Partial<ContextParams>): Promise<T>;
  /** code -> id and id -> code of the accounts (filled after the seeds). */
  acc: Record<string, string>;
  codeOf: Map<string, string>;
  close(): Promise<void>;
}

export async function setupScenario(): Promise<Scenario> {
  if (RetailPack.name !== 'retail') throw new TypeError('retail pack not registered');
  registerCrudActions();
  registerPackActions();
  const db = await freshDb();
  const run: Scenario['run'] = (fn, params = {}) => db.run({ now: () => FIXED_NOW, ...params }, fn);
  const act: Scenario['act'] = (name, input, params = {}) => run((ctx) => runAction(ctx, name, input), params) as never;
  return { db, run, act, acc: {}, codeOf: new Map(), close: () => db.close() };
}

/** Every module seed in module order, system context (owner connection), like db:reset. Returns the seeded module names. */
export async function seedModules(s: Scenario): Promise<string[]> {
  const seeded: string[] = [];
  for (const m of MODULES) {
    if (!m.seed) continue;
    await withContext(s.db.owner, systemParams(s.db.tenantId, s.db.companyId, { now: () => FIXED_NOW }), async (ctx) =>
      m.seed?.(ctx),
    );
    seeded.push(m.name);
  }
  return seeded;
}

export async function loadAccounts(s: Scenario): Promise<void> {
  const accounts = await s.act<ListJson>('account.list', { limit: 500, orderBy: [{ field: 'code', dir: 'asc' }] });
  s.acc = Object.fromEntries(accounts.items.map((a) => [String(a.code), String(a.id)]));
  s.codeOf = new Map(Object.entries(s.acc).map(([code, id]) => [id, code]));
}

/** Journal lines of an entry as [code, debit, credit] in seq order. */
export async function entryLines(s: Scenario, entryId: unknown): Promise<LineTriple[]> {
  if (typeof entryId !== 'string') return [];
  return s.run(async (ctx) => {
    const lines = await repo(ctx, JournalLine).list({
      where: { entryId },
      orderBy: [{ field: 'seq', dir: 'asc' }],
      limit: 100,
    });
    return lines.items.map((l): LineTriple => [
      s.codeOf.get(l.accountId) ?? l.accountId,
      l.debit.toString(),
      l.credit.toString(),
    ]);
  });
}

/** Journal lines of an entry as [code, taxCategory, taxRate] (rate normalised, '' when none). */
export async function entryTaxTags(s: Scenario, entryId: unknown): Promise<[string, string, string][]> {
  if (typeof entryId !== 'string') return [];
  return s.run(async (ctx) => {
    const lines = await repo(ctx, JournalLine).list({
      where: { entryId },
      orderBy: [{ field: 'seq', dir: 'asc' }],
      limit: 100,
    });
    return lines.items.map((l): [string, string, string] => [
      s.codeOf.get(l.accountId) ?? l.accountId,
      l.taxCategory ?? '',
      l.taxRate === null ? '' : l.taxRate.toString(),
    ]);
  });
}

export async function createSubmit<T extends DocJson>(s: Scenario, entity: string, head: Row): Promise<T> {
  const created = await s.act<T>(`${entity}.create`, head);
  await s.act(`${entity}.submit`, { id: created.id });
  return s.act<T>(`${entity}.get`, { id: created.id });
}

export const sum = (values: readonly unknown[]): string =>
  Decimal.sum(values.map((v) => Decimal.from(String(v)))).toString();

export const caught = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
