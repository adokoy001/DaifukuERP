// Migration runner: applies drizzle-kit migrations, then enforces RLS/grants that drizzle cannot express (ADR-0004).
import { sql } from 'drizzle-orm';
import { migrate as drizzleMigrate } from 'drizzle-orm/postgres-js/migrator';
import { getTableName } from 'drizzle-orm';
import { registry } from '../registry.ts';
import type { Database } from './client.ts';
import { NON_TENANT_TABLES } from './system-tables.ts';
import { APP_ROLE } from './table.ts';

export async function runMigrations(owner: Database, migrationsFolder: string): Promise<void> {
  await drizzleMigrate(owner.drizzle, { migrationsFolder });
  await enforcePolicies(owner);
}

/**
 * Idempotent post-migration hardening:
 * - FORCE ROW LEVEL SECURITY on every tenant table (owner is also subject to policies)
 * - least-privilege grants for the app role (audit_log: insert/select only; sequences: no delete)
 */
export async function enforcePolicies(owner: Database): Promise<void> {
  const tables = registry.tables();
  await owner.drizzle.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`));
  for (const [name, table] of Object.entries(tables)) {
    const tableName = getTableName(table);
    if (NON_TENANT_TABLES.includes(name)) continue;
    await owner.drizzle.execute(sql.raw(`ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY`));
    const grants = grantsFor(name);
    await owner.drizzle.execute(sql.raw(`REVOKE ALL ON "${tableName}" FROM ${APP_ROLE}`));
    await owner.drizzle.execute(sql.raw(`GRANT ${grants} ON "${tableName}" TO ${APP_ROLE}`));
  }
  // Append-only audit: even the owner cannot update/delete rows (defence in depth; 電帳法 訂正削除履歴).
  await owner.drizzle.execute(
    sql.raw(`CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$`),
  );
  await owner.drizzle.execute(sql.raw(`DROP TRIGGER IF EXISTS audit_log_immutable_trg ON audit_log`));
  await owner.drizzle.execute(
    sql.raw(
      `CREATE TRIGGER audit_log_immutable_trg BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_immutable()`,
    ),
  );
}

function grantsFor(name: string): string {
  switch (name) {
    case 'audit_log':
      return 'SELECT, INSERT';
    case 'sequences':
      return 'SELECT, INSERT, UPDATE';
    default:
      return 'SELECT, INSERT, UPDATE, DELETE';
  }
}

/** Drops every registered table (test databases only). */
export async function dropAll(owner: Database): Promise<void> {
  await owner.drizzle.execute(
    sql.raw(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;`),
  );
  await owner.drizzle.execute(sql.raw(`DROP SCHEMA IF EXISTS drizzle CASCADE;`));
}
