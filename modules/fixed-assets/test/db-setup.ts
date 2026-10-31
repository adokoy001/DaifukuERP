// Shared setup of the fixed-assets DB suites: a fresh database with the module registered, the test rule set at the
// override point, the accounts of the JP chart the module posts to, tax rates and fiscal years (docs/specs/fixed-assets.md).
import {
  companies,
  newId,
  registerCrudActions,
  registry,
  repo,
  runAction,
  setSetting,
  systemParams,
  withContext,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Account } from '@daifuku/mod-accounting';
import { TaxModule } from '@daifuku/mod-tax';
import {
  FIXED_ASSET_RULES_OVERRIDE,
  RULES_CONFIRMATION_KEY,
  rulesConfirmationSchema,
  type DepreciationRuleSet,
} from '../src/index.ts';
import { TEST_RULES } from './fixture-rules.ts';

export type Row = Record<string, unknown>;

export const ACCOUNTS: [string, string, string, string, Row?][] = [
  ['1100', '普通預金', 'asset', '現金預金'],
  ['1300', '売掛金', 'asset', '売掛金', { partnerRequired: true }],
  ['1910', '未収入金', 'asset', 'その他流動資産'],
  ['1923', '機械装置', 'asset', '有形固定資産'],
  ['1925', '工具器具備品', 'asset', '有形固定資産'],
  ['1929', '減価償却累計額', 'asset', '有形固定資産'],
  ['1930', 'ソフトウエア', 'asset', '無形固定資産'],
  ['2200', '仮受消費税', 'liability', '仮受消費税', { taxRole: 'output_tax' }],
  ['4000', '売上高', 'revenue', '売上', { taxCategoryDefault: 'standard' }],
  ['6700', '減価償却費', 'expense', '販売費及び一般管理費', { taxCategoryDefault: 'out_of_scope' }],
  ['8100', '固定資産売却益', 'revenue', '特別利益'],
  ['8200', '固定資産売却損', 'expense', '特別損失', { taxCategoryDefault: 'out_of_scope' }],
  ['8300', '固定資産除却損', 'expense', '特別損失', { taxCategoryDefault: 'out_of_scope' }],
];

export interface Env {
  db: TestDb;
  run<T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>): Promise<T>;
  act<T = Row>(name: string, input: unknown, params?: Partial<ContextParams>): Promise<T>;
  account(code: string, companyId?: string): Promise<string>;
  periodId(code: string, companyId?: string): Promise<string>;
}

export const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
export const caught = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
export const issues = (e: unknown) =>
  ((e as { details?: { issues?: { path: string; message: string }[] } }).details?.issues ?? []).map((i) => i.path);

export function useRules(rules: DepreciationRuleSet | null = TEST_RULES): void {
  registry.registerOverride(FIXED_ASSET_RULES_OVERRIDE, () => rules);
}

/** Seeds accounts, tax rates and fiscal years for the company of `params`; confirms the test rules unless told not to. */
export async function seedCompany(
  env: Pick<Env, 'run' | 'act'>,
  opts: { fiscalYears: string[]; confirm?: boolean; companyId?: string; tenantId?: string },
): Promise<void> {
  const params: Partial<ContextParams> = opts.companyId ? { companyId: opts.companyId } : {};
  await env.run(params, async (ctx) => {
    for (const [code, name, type, subtype, extra] of ACCOUNTS)
      await repo(ctx, Account).create({ code, name, type: type as 'asset', subtype, ...(extra ?? {}) });
    for (const startDate of opts.fiscalYears) await runAction(ctx, 'accounting.open_fiscal_year', { startDate });
    if (opts.confirm !== false)
      await setSetting(ctx, RULES_CONFIRMATION_KEY, rulesConfirmationSchema, {
        ruleSetId: TEST_RULES.id,
        confirmedOn: '2026-10-30',
      });
  });
}

export async function setupEnv(now: Date, opts: { fiscalYears: string[]; confirm?: boolean }): Promise<Env> {
  registerCrudActions();
  useRules();
  const db = await freshDb();
  await withContext(db.app, systemParams(db.tenantId, db.companyId, { now: () => now }), async (ctx) => {
    await TaxModule.seed?.(ctx);
  });
  const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>) =>
    db.run({ now: () => now, ...params }, fn);
  const act = <T = Row>(name: string, input: unknown, params: Partial<ContextParams> = {}) =>
    run(params, async (ctx) => (await runAction(ctx, name, input)) as T);
  const account = (code: string, companyId?: string) =>
    run(companyId ? { companyId } : {}, async (ctx) => {
      const found = await repo(ctx, Account).list({ where: { code }, limit: 1 });
      const id = found.items[0]?.id;
      if (!id) throw new Error(`account ${code} missing`);
      return id;
    });
  const periodId = (code: string, companyId?: string) =>
    run(companyId ? { companyId } : {}, async (ctx) => {
      const found = (await runAction(ctx, 'fiscal_period.list', { where: { code }, limit: 1 })) as {
        items: { id: string }[];
      };
      const id = found.items[0]?.id;
      if (!id) throw new Error(`period ${code} missing`);
      return id;
    });
  const env: Env = { db, run, act, account, periodId };
  await seedCompany(env, opts);
  return env;
}

/** Inserts a second company in the same tenant (contexts name it by companyId; no membership is needed in tests). */
export async function secondCompany(env: Env, code = 'T2'): Promise<string> {
  const id = newId();
  await env.db.owner.drizzle.insert(companies).values({ id, tenantId: env.db.tenantId, code, name: '別会社' });
  return id;
}
