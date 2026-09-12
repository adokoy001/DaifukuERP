// Company settings port (ADR-0013 L1): typed key/value stored in companies.settings (JSONB), audited.
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { writeAudit } from './audit.ts';
import { isAdmin, type Context } from './context.ts';
import { companies } from './db/system-tables.ts';
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
  return { id: c.id, code: c.code, name: c.name, country: c.country, currency: c.currency, settings: (c.settings ?? {}) as Record<string, unknown> };
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

/** Writes one setting (admin or role `settings`). Validated by the schema; audited as entity `company_settings`. */
export async function setSetting<T>(ctx: Context, key: string, schema: z.ZodType<T>, value: unknown): Promise<T> {
  if (ctx.accessScope && ctx.accessScope !== 'all') throw new PermissionDenied('company_settings', 'update', ctx.roles);
  if (!isAdmin(ctx) && !ctx.roles.includes('settings')) throw new PermissionDenied('company_settings', 'update', ctx.roles);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(`invalid value for setting ${key}`, parsed.error.issues.map((i) => ({ path: [key, ...i.path.map(String)].join('.'), message: i.message })));
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
