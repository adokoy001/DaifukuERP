// Test support (import from '@daifuku/kernel/testing'): fresh schema on the test database, bootstrap tenant, context factory.
// Set TEST_DATABASE_URL_OWNER / TEST_DATABASE_URL to point at a database dedicated to the test run.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { bootstrapTenant } from './auth.ts';
import { connect, withContext, type Database } from './db/client.ts';
import { dropAll } from './db/migrate.ts';
import { createSchemaFromScratch } from './db/schema-sync.ts';
import type { Context, ContextParams } from './context.ts';

function loadEnv(): void {
  for (const dir of [process.cwd(), resolve(process.cwd(), '..'), resolve(process.cwd(), '../..'), resolve(process.cwd(), '../../..')]) {
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

export const OWNER_URL = process.env.TEST_DATABASE_URL_OWNER ?? 'postgres://daifuku_owner:owner@localhost:5432/daifuku_test';
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

/** Drops and recreates the whole schema from the current registry, then bootstraps one tenant. */
export async function freshDb(): Promise<TestDb> {
  const owner = connect(OWNER_URL, { max: 2 });
  const app = connect(APP_URL, { max: 4 });
  await dropAll(owner);
  await createSchemaFromScratch(owner);
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
