// Company settings port (ADR-0013 L1): typed key/value stored in companies.settings (JSONB), audited.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { writeAudit } from './audit.ts';
import { isAdmin, type Context } from './context.ts';
import { auditLog, companies, users } from './db/system-tables.ts';
import { NotFound, PermissionDenied, ValidationError } from './errors.ts';

export interface CompanyInfo {
  id: string;
  code: string;
  name: string;
  country: string;
  currency: string;
  settings: Record<string, unknown>;
}

/**
 * ISO 4217 minor units for display hints (FieldMeta.scale of money fields, apps' formatting). Currencies not listed use 2.
 * Display only: tax rounding has its own rule in modules/tax.
 */
const CURRENCY_SCALES: Readonly<Record<string, number>> = { JPY: 0, KRW: 0 };
export const DEFAULT_CURRENCY_SCALE = 2;

export function currencyScale(currency: string): number {
  return CURRENCY_SCALES[currency.trim().toUpperCase()] ?? DEFAULT_CURRENCY_SCALE;
}

/** The context's company, or null when the context has none (tenant-level requests) or it is not visible. */
export async function findCompany(ctx: Context): Promise<CompanyInfo | null> {
  if (!ctx.companyId) return null;
  const rows = await ctx.db
    .select()
    .from(companies)
    .where(and(eq(companies.tenantId, ctx.tenantId), eq(companies.id, ctx.companyId)))
    .limit(1);
  const c = rows[0];
  if (!c) return null;
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    country: c.country,
    currency: c.currency,
    settings: (c.settings ?? {}) as Record<string, unknown>,
  };
}

export async function getCompany(ctx: Context): Promise<CompanyInfo> {
  const company = await findCompany(ctx);
  if (!company) throw new NotFound('company', ctx.companyId ?? 'null');
  return company;
}

/** Reads one setting, validated by the module's schema. Missing/invalid values fall back to `fallback`. */
export async function getSetting<T>(ctx: Context, key: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  const company = await getCompany(ctx);
  const raw = company.settings[key];
  if (raw === undefined) return fallback;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    ctx.log.warn('invalid company setting, using fallback', { key, issues: parsed.error.issues });
    return fallback;
  }
  return parsed.data;
}

/** Company settings are changed and their history read by admin or role `settings`, never by a store/site-scoped member. */
function assertSettingsAccess(ctx: Context, op: 'update' | 'delete' | 'audit'): void {
  if (ctx.accessScope && ctx.accessScope !== 'all') throw new PermissionDenied('company_settings', op, ctx.roles);
  if (!isAdmin(ctx) && !ctx.roles.includes('settings')) throw new PermissionDenied('company_settings', op, ctx.roles);
}

/** Writes one setting (admin or role `settings`). Validated by the schema; audited as entity `company_settings`. */
export async function setSetting<T>(ctx: Context, key: string, schema: z.ZodType<T>, value: unknown): Promise<T> {
  assertSettingsAccess(ctx, 'update');
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(
      `invalid value for setting ${key}`,
      parsed.error.issues.map((i) => ({ path: [key, ...i.path.map(String)].join('.'), message: i.message })),
    );
  }
  const company = await getCompany(ctx);
  const before = company.settings[key];
  const patch = JSON.stringify({ [key]: parsed.data });
  await ctx.db
    .update(companies)
    .set({ settings: sql`${companies.settings} || ${patch}::jsonb` })
    .where(and(eq(companies.tenantId, ctx.tenantId), eq(companies.id, company.id)));
  await writeAudit(ctx, 'company_settings', company.id, 'update', { [key]: before ?? null }, { [key]: parsed.data });
  return parsed.data;
}

/**
 * Removes the company's stored value so the module falls back to its default (ADR-0027). Same access as setSetting;
 * audited as `company_settings` op `delete` with the previous value and `null`. Returns false (nothing written, no
 * audit) when the company has no stored value. The company row is locked so the audited value is the one removed.
 */
export async function deleteSetting(ctx: Context, key: string): Promise<boolean> {
  assertSettingsAccess(ctx, 'delete');
  if (!ctx.companyId) throw new NotFound('company', 'null');
  const rows = await ctx.db
    .select({ id: companies.id, settings: companies.settings })
    .from(companies)
    .where(and(eq(companies.tenantId, ctx.tenantId), eq(companies.id, ctx.companyId)))
    .limit(1)
    .for('update');
  const company = rows[0];
  if (!company) throw new NotFound('company', ctx.companyId);
  const stored = (company.settings ?? {}) as Record<string, unknown>;
  if (!Object.hasOwn(stored, key)) return false;
  await ctx.db
    .update(companies)
    .set({ settings: sql`${companies.settings} - ${key}::text` })
    .where(and(eq(companies.tenantId, ctx.tenantId), eq(companies.id, company.id)));
  await writeAudit(ctx, 'company_settings', company.id, 'delete', { [key]: stored[key] ?? null }, { [key]: null });
  return true;
}

/** One change of one setting, newest first (settingHistory). `before` / `after` are the key's values (null = unset). */
export interface SettingChange {
  id: string;
  at: Date;
  op: string;
  actorType: string;
  actorId: string;
  /** Display name of the acting user (or null when the actor is not a user of this tenant). */
  actorName: string | null;
  onBehalfOf: string | null;
  onBehalfOfName: string | null;
  action: string | null;
  before: unknown;
  after: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function keyValue(snapshot: unknown, key: string): unknown {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  return (snapshot as Record<string, unknown>)[key] ?? null;
}

/**
 * The latest `limit` (max 100) audited changes of one setting of the context's company, newest first: every
 * `company_settings` audit row whose before or after snapshot carries the key (setSetting, deleteSetting, pack:apply,
 * seeds). Same access as setSetting. Actor names come from the tenant's users (name only).
 */
export async function settingHistory(ctx: Context, key: string, limit = 20): Promise<SettingChange[]> {
  assertSettingsAccess(ctx, 'audit');
  const company = await getCompany(ctx);
  const rows = await ctx.db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.tenantId, ctx.tenantId),
        eq(auditLog.companyId, company.id),
        eq(auditLog.entity, 'company_settings'),
        eq(auditLog.recordId, company.id),
        sql`((${auditLog.before} -> ${key}::text) is not null or (${auditLog.after} -> ${key}::text) is not null)`,
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(Math.max(1, Math.min(limit, 100)));
  const ids = [...new Set(rows.flatMap((r) => [r.actorId, r.onBehalfOf ?? '']).filter((id) => UUID_RE.test(id)))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const people = await ctx.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, ctx.tenantId), inArray(users.id, ids)));
    for (const p of people) names.set(p.id, p.name);
  }
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    op: r.op,
    actorType: r.actorType,
    actorId: r.actorId,
    actorName: names.get(r.actorId) ?? null,
    onBehalfOf: r.onBehalfOf,
    onBehalfOfName: r.onBehalfOf ? (names.get(r.onBehalfOf) ?? null) : null,
    action: r.action,
    before: keyValue(r.before, key),
    after: keyValue(r.after, key),
  }));
}
