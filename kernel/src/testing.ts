// Test support (import from '@daifuku/kernel/testing'): fresh schema on the test database, bootstrap tenant, context factory.
// Set TEST_DATABASE_URL_OWNER / TEST_DATABASE_URL to point at a database dedicated to the test run. freshDb() recreates
// that database from a schema template when it can (test-database.ts, docs/specs/db-test-startup.md); set
// TEST_DATABASE_TEMPLATE=off to always rebuild the schema in place.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { bootstrapTenant } from './auth.ts';
import { connect, withContext, type Database } from './db/client.ts';
import { dropAll } from './db/migrate.ts';
import { createSchemaFromScratch } from './db/schema-sync.ts';
import { prepareFromTemplate, templateTarget, type TemplateOutcome } from './test-database.ts';
import type { Context, ContextParams } from './context.ts';

function loadEnv(): void {
  for (const dir of [
    process.cwd(),
    resolve(process.cwd(), '..'),
    resolve(process.cwd(), '../..'),
    resolve(process.cwd(), '../../..'),
  ]) {
    const p = resolve(dir, '.env');
    if (existsSync(p)) {
      try {
        process.loadEnvFile(p);
      } catch {
        /* ignore */
      }
      return;
    }
  }
}
loadEnv();

export const OWNER_URL =
  process.env.TEST_DATABASE_URL_OWNER ?? 'postgres://daifuku_owner:owner@localhost:5432/daifuku_test';
export const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://daifuku_app:app@localhost:5432/daifuku_test';

export interface TestDb {
  owner: Database;
  app: Database;
  tenantId: string;
  companyId: string;
  adminUserId: string;
  /** Runs fn in an app-role transaction for the bootstrapped tenant/company. */
  run<T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

let lastPreparation: TemplateOutcome | null = null;
const notices = new Set<string>();

/** How the latest freshDb() in this process prepared the schema: cloned, built a template, or rebuilt in place. */
export function schemaPreparation(): TemplateOutcome | null {
  return lastPreparation;
}

// A schema with every registered table and no rows: from a template when possible, else rebuilt in place.
async function preparedOwner(): Promise<Database> {
  const target = templateTarget(OWNER_URL, APP_URL, process.env);
  if (target.ok) {
    const prepared = await prepareFromTemplate(target, OWNER_URL);
    lastPreparation = prepared.outcome;
    if (prepared.owner) return prepared.owner;
  } else lastPreparation = { used: 'legacy', reason: target.reason };
  if (lastPreparation.used === 'legacy' && !(!target.ok && target.disabled) && !notices.has(lastPreparation.reason)) {
    notices.add(lastPreparation.reason);
    process.stderr.write(
      `[kernel/testing] schema templates not used: ${lastPreparation.reason}; rebuilding the schema in place ` +
        '(docs/specs/db-test-startup.md).\n',
    );
  }
  const owner = connect(OWNER_URL, { max: 2 });
  await dropAll(owner);
  await createSchemaFromScratch(owner);
  return owner;
}

/** Gives the test database every table of the current registry and no data, then bootstraps one tenant. */
export async function freshDb(): Promise<TestDb> {
  const owner = await preparedOwner();
  const app = connect(APP_URL, { max: 4 });
  const boot = await bootstrapTenant(owner, {
    tenantName: 'Test Tenant',
    companyCode: 'T1',
    companyName: 'テスト株式会社',
    adminEmail: 'admin@example.com',
    adminName: 'Admin',
    adminPassword: 'password',
  });
  const base = { tenantId: boot.tenantId, companyId: boot.companyId };
  return {
    owner,
    app,
    tenantId: boot.tenantId,
    companyId: boot.companyId,
    adminUserId: boot.userId,
    run: (params, fn) =>
      withContext(
        app,
        {
          ...base,
          actor: { type: 'user', id: boot.userId },
          roles: ['admin'],
          ...params,
        },
        fn,
      ),
    close: async () => {
      await app.close();
      await owner.close();
    },
  };
}
