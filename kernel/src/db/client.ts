// Database connection and context-scoped transactions (ADR-0004).
import { and, eq, sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { consoleLogger, type Context, type ContextParams, type Db } from '../context.ts';
import { newId } from '../ids.ts';
import { insertOutbox } from '../event-insert.ts';
import { storage } from '../storage.ts';
import { TENANT_SETTING } from './table.ts';
import { companies } from './system-tables.ts';
import { StateError } from '../errors.ts';
import { appliedPackNames } from '../pack-scope.ts';

export interface Database {
  readonly drizzle: PostgresJsDatabase;
  readonly sql: postgres.Sql;
  close(): Promise<void>;
}

export function connect(url: string, opts: { max?: number } = {}): Database {
  const client = postgres(url, {
    max: opts.max ?? 10,
    // numeric comes back as string; we convert to Decimal in the repository. Dates as JS Date.
    transform: { undefined: null },
    onnotice: () => undefined,
  });
  return { drizzle: drizzle(client), sql: client, close: () => client.end({ timeout: 5 }) };
}

/**
 * Runs `fn` in a transaction with the tenant set for RLS and a fully built Context.
 * This is the ONLY way to obtain a Context; there is no bypass (ADR-0007).
 */
export async function withContext<T>(database: Database, params: ContextParams, fn: (ctx: Context) => Promise<T>): Promise<T> {
  return database.drizzle.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config(${TENANT_SETTING}, ${params.tenantId}, true)`);
    let appliedPacks: string[] = [];
    if (params.companyId) {
      const company = await tx.select({ id: companies.id, settings: companies.settings }).from(companies).where(and(eq(companies.id, params.companyId), eq(companies.tenantId, params.tenantId))).limit(1);
      if (!company.length) throw new StateError('Company does not belong to the current tenant', 'Select a company within the authenticated tenant.');
      appliedPacks = appliedPackNames(company[0]?.settings);
    }
    const ctx = makeContext(tx, { ...params, appliedPacks });
    return fn(ctx);
  });
}

export function makeContext(db: Db, params: ContextParams): Context {
  const now = params.now ?? (() => new Date());
  const ctx: Context = {
    ...(params.sessionVersion === undefined ? {} : { sessionVersion: params.sessionVersion }),
    ...(params.mfaVerified === undefined ? {} : { mfaVerified: params.mfaVerified }),
    accessScope: params.accessScope ?? 'all',
    storeIds: params.storeIds ?? [],
    siteIds: params.siteIds ?? [],
    tenantAdmin: params.tenantAdmin ?? false,
    appliedPacks: params.appliedPacks ?? [],
    tenantId: params.tenantId,
    companyId: params.companyId,
    actor: params.actor,
    ...(params.relay ? { relay: params.relay } : {}),
    roles: params.roles,
    requestId: params.requestId ?? newId(),
    locale: params.locale ?? 'ja',
    db,
    log: params.log ?? consoleLogger,
    get storage() {
      return storage();
    },
    now,
    emit: (topic, payload) => insertOutbox(ctx, topic, payload),
  };
  return ctx;
}

/** Context for migrations, seeds and workers. Has the admin role; audit records actor.type='system'. */
export function systemParams(tenantId: string, companyId: string | null, extra: Partial<ContextParams> = {}): ContextParams {
  return { tenantId, companyId, actor: { type: 'system', id: 'system' }, roles: ['admin'], ...extra };
}
