// Company creation and editing by tenant administrators (docs/specs/company-admin.md, ADR-0029). createCompany inserts
// the company row, gives the creator an admin membership, runs every module seed for the new company in a system
// Context and writes the audit, all in the caller's transaction: a failing seed rolls everything back (AC-10). The
// request's app-role connection may insert into `companies` (RLS allows the caller's own tenant), so no owner connection
// is involved; seeds are the only system-Context work and they stay inside the same transaction.
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { actorUser, assertAccessAdmin, managedUser, writeAccessAudit } from './access-admin-common.ts';
import { publicMembership } from './access-memberships.ts';
import type { Context } from './context.ts';
import { makeContext, systemParams } from './db/client.ts';
import { companies, companyMemberships, users } from './db/system-tables.ts';
import type { ModuleDef } from './dsl/defs.ts';
import { DaifukuError, NotFound, safeErrorDiagnostics, StateError, ValidationError } from './errors.ts';
import { newId } from './ids.ts';
import { registry } from './registry.ts';

/** Company code: upper-case letters, digits, `_` and `-`, 1 to 20 characters (AC-3). */
export const COMPANY_CODE = /^[A-Z0-9_-]{1,20}$/;
const country = z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2 (e.g. JP)');
/**
 * Currencies a new company may have. Sales, purchase and payment submit refuse a company whose currency is not JPY
 * (modules/accounting money-contract), and the currency is immutable, so a company created with another currency could
 * never post. Until multi-currency business exists only JPY is accepted (docs/specs/company-admin.md AC-3).
 */
export const SUPPORTED_COMPANY_CURRENCIES = ['JPY'] as const;

export const createCompanySchema = z
  .object({
    code: z.string().regex(COMPANY_CODE, 'A-Z, 0-9, _ and -, 1 to 20 characters'),
    name: z.string().trim().min(1).max(200),
    country: country.default('JP'),
    currency: z
      .enum(SUPPORTED_COMPANY_CURRENCIES, { error: 'only JPY is supported until multi-currency business exists' })
      .default('JPY'),
  })
  .strict();
export const updateCompanySchema = z
  .object({ name: z.string().trim().min(1).max(200).optional(), country: country.optional() })
  .strict();

const IMMUTABLE = ['code', 'currency'] as const;

export interface AdminCompany {
  id: string;
  code: string;
  name: string;
  country: string;
  currency: string;
  createdAt: Date;
}

function parseCompany<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(
      'Invalid company',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  return parsed.data;
}

function publicCompany(row: typeof companies.$inferSelect): AdminCompany {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    country: row.country,
    currency: row.currency,
    createdAt: row.createdAt,
  };
}

/** Every company of the tenant (AC-5), with whether the caller has a membership in it. Tenant administrators only. */
export async function listCompanies(ctx: Context): Promise<{ items: (AdminCompany & { member: boolean })[] }> {
  await assertAccessAdmin(ctx);
  const rows = await ctx.db
    .select()
    .from(companies)
    .where(eq(companies.tenantId, ctx.tenantId))
    .orderBy(companies.code);
  const memberships = await ctx.db
    .select({ companyId: companyMemberships.companyId })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.tenantId, ctx.tenantId), eq(companyMemberships.userId, actorUser(ctx))));
  const mine = new Set(memberships.map((m) => m.companyId));
  return { items: rows.map((row) => ({ ...publicCompany(row), member: mine.has(row.id) })) };
}

export interface CreateCompanyOptions {
  /**
   * Modules whose seed runs for the new company, in order. Apps pass the same runtime module list setup and db:reset
   * seed with; the default is every registered module in registration (dependency) order.
   */
  modules?: readonly ModuleDef[];
}

export interface CreatedCompany extends AdminCompany {
  /** Modules whose seed ran for the new company, in order. */
  seededModules: string[];
}

/**
 * Creates a company in the caller's tenant (AC-1): the row, the creator's `admin` membership, every module seed in a
 * system Context of the new company (ADR-0029) and the audit, in the caller's transaction. Tenant administrators only.
 */
export async function createCompany(
  ctx: Context,
  raw: unknown,
  options: CreateCompanyOptions = {},
): Promise<CreatedCompany> {
  await assertAccessAdmin(ctx, true);
  const input = parseCompany(createCompanySchema, raw);
  // The access-admin lock taken above serializes company creation in the tenant, so this check cannot race.
  const [taken] = await ctx.db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.tenantId, ctx.tenantId), eq(companies.code, input.code)))
    .limit(1);
  if (taken)
    throw new ValidationError(
      'Company code is already used in this tenant',
      [{ path: 'code', message: 'already used' }],
      'Choose a code no other company of the tenant has.',
    );
  const id = newId();
  const [row] = await ctx.db
    .insert(companies)
    .values({ id, tenantId: ctx.tenantId, ...input })
    .returning();
  if (!row) throw new StateError('Company was not created', 'Retry the request.');
  const userId = actorUser(ctx);
  const [membership] = await ctx.db
    .insert(companyMemberships)
    .values({ tenantId: ctx.tenantId, userId, companyId: id, roles: ['admin'] })
    .returning();
  if (!membership) throw new StateError('Creator membership was not created', 'Retry the request.');
  // Like a first membership assignment (putCompanyMembership): a creator with no default company gets this one.
  const creator = await managedUser(ctx, userId);
  if (!creator.defaultCompanyId)
    await ctx.db
      .update(users)
      .set({ defaultCompanyId: id, version: creator.version + 1 })
      .where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, userId)));
  const company = publicCompany(row);
  await writeAccessAudit(ctx, id, 'company', id, 'create', null, { ...company });
  await writeAccessAudit(ctx, id, 'company_membership', userId, 'create', null, publicMembership(membership));
  const seededModules = await seedCompany(ctx, id, options.modules ?? registry.allModules());
  return { ...company, seededModules };
}

/** Runs each module seed in a system Context of `companyId`, inside the caller's transaction (ADR-0029). */
async function seedCompany(ctx: Context, companyId: string, modules: readonly ModuleDef[]): Promise<string[]> {
  const seedCtx = makeContext(
    ctx.db,
    systemParams(ctx.tenantId, companyId, {
      requestId: ctx.requestId,
      locale: ctx.locale,
      log: ctx.log,
      now: () => ctx.now(),
    }),
  );
  const seeded: string[] = [];
  for (const module of modules) {
    if (!module.seed) continue;
    try {
      await module.seed(seedCtx);
    } catch (error) {
      // The public error names the module only: a raw message may carry SQL and bound values (DrizzleQueryError), so
      // a non-Daifuku cause contributes its SQLSTATE alone (docs/conventions/errors.md, safeErrorDiagnostics).
      const diagnostics = error instanceof DaifukuError ? { cause: error.toBody() } : safeErrorDiagnostics(error);
      ctx.log.warn('company seed failed', { module: module.name, requestId: ctx.requestId, ...diagnostics });
      throw new StateError(
        `Initial data of module "${module.name}" could not be created`,
        'Nothing was created (the company, the membership and every seed were rolled back). Report the request id to the operator, fix the cause and create the company again.',
        { module: module.name, ...diagnostics },
      );
    }
    seeded.push(module.name);
  }
  return seeded;
}

/** Changes a company's name or country (AC-4), audited with before and after. `code` and `currency` are immutable. */
export async function updateCompany(ctx: Context, id: string, raw: unknown): Promise<AdminCompany> {
  await assertAccessAdmin(ctx, true);
  if (typeof raw === 'object' && raw !== null) {
    const fixed = IMMUTABLE.filter((key) => Object.hasOwn(raw, key));
    if (fixed.length)
      throw new ValidationError(
        'Company code and currency cannot be changed after creation',
        fixed.map((key) => ({ path: key, message: 'immutable after creation' })),
        'Change only name or country. Create a new company for a different code or currency.',
      );
  }
  const input = parseCompany(updateCompanySchema, raw);
  const [current] = await ctx.db
    .select()
    .from(companies)
    .where(and(eq(companies.tenantId, ctx.tenantId), eq(companies.id, id)))
    .limit(1)
    .for('update');
  if (!current) throw new NotFound('company', id);
  const changes = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.country !== undefined ? { country: input.country } : {}),
  };
  if (!Object.keys(changes).length) return publicCompany(current);
  const [after] = await ctx.db
    .update(companies)
    .set(changes)
    .where(and(eq(companies.tenantId, ctx.tenantId), eq(companies.id, current.id)))
    .returning();
  if (!after) throw new StateError('Company was not updated', 'Reload the company list and retry.');
  const result = publicCompany(after);
  await writeAccessAudit(ctx, after.id, 'company', after.id, 'update', { ...publicCompany(current) }, { ...result });
  return result;
}
