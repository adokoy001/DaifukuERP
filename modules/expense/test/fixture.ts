// Shared Postgres fixture of the expense module tests (docs/specs/expense-settlement.md). One company with two
// workforce sites, employees, a site manager per site, HR / payroll / accounting users, a settler holding both
// accounting and workforce_payroll (D8), the Japanese account codes the settings default to (seeded by hand: modules
// do not import l10n/jp), tax rates, the fiscal year 2026 and the purchase credit-ratio override with the transitional
// 80% / 70% periods (test data mirroring l10n/jp/src/services/transitional-credit.ts, docs/domain/japan-tax.md).
import {
  companyMemberships,
  type Decimal,
  hashPassword,
  newId,
  registerCrudActions,
  registry,
  repo,
  runAction,
  users,
  type Context,
  type ContextParams,
  type LocalDate,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Account, JournalLine, openFiscalYear } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { PURCHASE_CREDIT_RATIO_POINT } from '@daifuku/mod-purchase';
import { seedTaxRates } from '@daifuku/mod-tax';
import { seedWorkforce, WorkforceSite } from '@daifuku/mod-workforce';
import '../src/index.ts';
import { testCreditRatio } from './ratio.ts';

export type Row = Record<string, unknown>;
export interface Command {
  id: string;
  version: number;
  status: string;
}
export type Person = { id: string; params: Partial<ContextParams> };
export interface Worker extends Person {
  employeeId: string;
  name: string;
}

/** 2026-10-10 09:00 JST: "today" of every call unless a test passes another time. */
export const NOW = '2026-10-10T09:00:00+09:00';
export const at = (value: string): Partial<ContextParams> => ({ now: () => new Date(value) });

export const ACCOUNT_CODES = {
  '1000': ['現金', 'asset', {}],
  '1100': ['普通預金', 'asset', {}],
  '1300': ['売掛金', 'asset', { partnerRequired: true }],
  '1500': ['仮払消費税', 'asset', { taxRole: 'input_tax' }],
  '1800': ['仮払金', 'asset', {}],
  '1900': ['前払金', 'asset', {}],
  '2100': ['買掛金', 'liability', { partnerRequired: true }],
  '2150': ['未払金', 'liability', {}],
  '2200': ['仮受消費税', 'liability', { taxRole: 'output_tax' }],
  '2400': ['前受金', 'liability', {}],
  '5000': ['仕入高', 'expense', { taxCategoryDefault: 'standard' }],
  '6500': ['旅費交通費', 'expense', { taxCategoryDefault: 'standard' }],
  '6900': ['雑費', 'expense', { taxCategoryDefault: 'standard' }],
} as const;
export type Code = keyof typeof ACCOUNT_CODES;

export async function fixture() {
  registerCrudActions();
  registry.registerOverride(PURCHASE_CREDIT_RATIO_POINT, testCreditRatio);
  const db: TestDb = await freshDb();
  const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>, time = NOW) =>
    db.run({ ...params, ...at(time) }, fn);
  const act = <T = Row>(params: Partial<ContextParams>, name: string, input: unknown, time = NOW) =>
    run(params, (ctx) => runAction(ctx, name, input) as Promise<T>, time);

  const [siteA, siteB] = await run({}, async (ctx) => {
    await seedWorkforce(ctx);
    await seedTaxRates(ctx);
    await openFiscalYear(ctx, { startDate: '2026-01-01' });
    return [
      await repo(ctx, WorkforceSite).create({ code: 'A', name: '東拠点' }),
      await repo(ctx, WorkforceSite).create({ code: 'B', name: '西拠点' }),
    ];
  });
  if (!siteA || !siteB) throw new Error('missing sites');
  const siteAId = siteA.id;
  const acc = {} as Record<Code, string>;
  await run({}, async (ctx) => {
    for (const [code, [name, type, extra]] of Object.entries(ACCOUNT_CODES))
      acc[code as Code] = (await repo(ctx, Account).create({ code, name, type, ...extra } as never)).id;
  });
  const codeOf = new Map(Object.entries(acc).map(([code, id]) => [id, code]));

  async function person(name: string, roles: string[], siteIds: string[] = [siteAId], userId = newId()) {
    const scoped = roles.some((r) => ['workforce_employee', 'workforce_manager'].includes(r));
    if (userId !== db.adminUserId)
      await db.owner.drizzle.insert(users).values({
        id: userId,
        tenantId: db.tenantId,
        email: `${name}@example.com`,
        name,
        passwordHash: await hashPassword('test-password'),
        roles,
        defaultCompanyId: db.companyId,
      });
    if (userId !== db.adminUserId)
      await db.owner.drizzle.insert(companyMemberships).values({
        tenantId: db.tenantId,
        companyId: db.companyId,
        userId,
        roles,
        accessScope: scoped ? 'sites' : 'all',
        siteIds: scoped ? siteIds : [],
      });
    const params: Partial<ContextParams> = {
      actor: { type: 'user', id: userId },
      roles,
      accessScope: scoped ? 'sites' : 'all',
      siteIds: scoped ? siteIds : [],
    };
    return { id: userId, params } satisfies Person;
  }
  const manager = await person('manager', ['workforce_manager']);
  const remote = await person('remote', ['workforce_manager'], [siteB.id]);
  const hr = await person('hr', ['workforce_hr']);
  const payroll = await person('payroll', ['workforce_payroll']);
  const accounting = await person('accounting', ['accounting']);
  const settler = await person('settler', ['accounting', 'workforce_payroll']);
  const admin: Person = { id: db.adminUserId, params: {} };

  let sequence = 0;
  /** Registers an employee at `site`; `existing` reuses a person (admin, or one with several sites). */
  async function worker(name = `emp${++sequence}`, site = siteAId, existing?: Person): Promise<Worker> {
    const p = existing ?? (await person(name, ['workforce_employee'], [site]));
    const row = await act<Command>(hr.params, 'workforce.register_employee', {
      userId: p.id,
      siteId: site,
      code: name,
      name,
      hiredOn: '2026-01-01',
    });
    return { ...p, employeeId: row.id, name };
  }
  const partner = (code: string, name: string) =>
    run({}, async (ctx) => (await repo(ctx, Partner).create({ code, name, isSupplier: true })).id);
  const partners = { alice: await partner('E-ALICE', '従業員 Alice'), card: await partner('CARD', 'カード会社') };

  /** Records, submits and (site manager) approves one expense; returns its id. */
  async function approvedExpense(w: Worker, overrides: Row = {}, approver: Person = manager): Promise<string> {
    const saved = await act<Command>(w.params, 'workforce.save_expense', {
      expectedVersion: 0,
      idempotencyKey: newId(),
      expenseDate: '2026-10-05',
      category: '交通費',
      description: '訪問交通費',
      amount: '1100',
      evidence: '領収書-001',
      ...overrides,
    });
    const submitted = await act<Command>(w.params, 'workforce.submit_expense', {
      expenseId: saved.id,
      expectedVersion: saved.version,
    });
    await act(approver.params, 'workforce.review_expense', {
      expenseId: saved.id,
      expectedVersion: submitted.version,
      decision: 'approve',
      reason: '証憑と用務を確認',
    });
    return saved.id;
  }

  type SettlementJson = Row & {
    id: string;
    version: number;
    docstatus: number;
    number: string | null;
    kind: string;
    total: string;
    journalEntryId: string | null;
    paymentId: string | null;
    lines: { expense_settlement_line: (Row & { id: string; expenseId: string; amount: string })[] };
  };
  const getSettlement = (id: string, params: Partial<ContextParams> = settler.params) =>
    act<SettlementJson>(params, 'expense_settlement.get', { id });
  const draft = (input: Row, params: Partial<ContextParams> = settler.params) =>
    act<{ id: string; version: number }>(params, 'expense.draft_settlement', input);
  /** Patches the header and, when given, replaces every line with `lines` (each merged onto the stored line). */
  async function edit(id: string, head: Row, lines?: Row[], params: Partial<ContextParams> = settler.params) {
    const current = await getSettlement(id);
    const editable = ['expenseId', 'payeeName', 'accountId', 'taxCategory', 'amount', 'invoiceKind'];
    const extra = ['booksOnlyReason', 'invoiceRegistrationNo'];
    const rows =
      lines?.map((patch, i) => {
        const stored = current.lines.expense_settlement_line[i];
        const base = stored ? Object.fromEntries([...editable, ...extra].map((k) => [k, stored[k]])) : ({} as Row);
        const { $new, ...rest } = patch;
        return { ...(stored && !$new ? { id: stored.id } : {}), ...(stored && !$new ? base : {}), ...rest };
      }) ?? undefined;
    return act<SettlementJson>(params, 'expense_settlement.update', {
      id,
      expectedVersion: current.version,
      patch: { ...head, ...(rows ? { lines: { expense_settlement_line: rows } } : {}) },
    });
  }
  const submit = (id: string, params: Partial<ContextParams> = settler.params, time = NOW) =>
    act<SettlementJson>(params, 'expense_settlement.submit', { id }, time);
  const cancel = (id: string, correctionDate?: string, params: Partial<ContextParams> = settler.params) =>
    act<SettlementJson>(params, 'expense_settlement.cancel', { id, ...(correctionDate ? { correctionDate } : {}) });

  /** Journal lines of an entry as [code, debit, credit, taxCategory, taxRate, memo, partner?]. */
  async function entryLines(entryId: string) {
    return run({}, async (ctx) => {
      const lines = await repo(ctx, JournalLine).list({
        where: { entryId },
        orderBy: [{ field: 'seq', dir: 'asc' }],
        limit: 100,
      });
      return lines.items.map((l) => ({
        code: codeOf.get(l.accountId) ?? l.accountId,
        debit: l.debit.toString(),
        credit: l.credit.toString(),
        taxCategory: l.taxCategory ?? null,
        taxRate: l.taxRate ? l.taxRate.toString() : null,
        memo: l.memo ?? null,
        partnerId: l.partnerId ?? null,
      }));
    });
  }
  /** Σdebit − Σcredit of posted lines for one account code. */
  async function balance(code: Code, partnerId?: string) {
    return run({}, async (ctx) => {
      const rows = await repo(ctx, JournalLine).aggregate({
        where: { posted: true, accountId: acc[code], ...(partnerId ? { partnerId } : {}) },
        groupBy: ['accountId'],
        metrics: { debit: { sum: 'debit' }, credit: { sum: 'credit' } },
      });
      const r = rows[0];
      return r ? (r.debit as Decimal).minus(r.credit as Decimal).toString() : '0';
    });
  }

  return {
    db,
    run,
    act,
    siteA: siteA.id,
    siteB: siteB.id,
    acc,
    codeOf,
    manager,
    remote,
    hr,
    payroll,
    accounting,
    settler,
    admin,
    person,
    worker,
    partner,
    partners,
    approvedExpense,
    getSettlement,
    draft,
    edit,
    submit,
    cancel,
    entryLines,
    balance,
  };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;

export const caught = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
export const today = (iso: string = NOW): LocalDate => iso.slice(0, 10) as LocalDate;
