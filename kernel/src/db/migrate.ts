// Migration runner: applies drizzle-kit migrations, then enforces RLS/grants that drizzle cannot express (ADR-0004).
import { sql } from 'drizzle-orm';
import { migrate as drizzleMigrate } from 'drizzle-orm/postgres-js/migrator';
import { getTableName } from 'drizzle-orm';
import { registry } from '../registry.ts';
import type { Database } from './client.ts';
import { NON_TENANT_TABLES } from './system-tables.ts';
import { APP_ROLE } from './table.ts';

/**
 * Use a dedicated owner connection while application writers are stopped; the caller owns and closes it.
 * After column type changes, reopen data connections instead of reusing prepared queries from the old schema.
 */
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
  for (const statement of policyStatements()) await owner.drizzle.execute(sql.raw(statement));
}

/** The statements enforcePolicies executes for the current registry, in order (the test harness hashes them). */
export function policyStatements(): string[] {
  const statements = [`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`];
  for (const [name, table] of Object.entries(registry.tables())) {
    const tableName = getTableName(table);
    if (NON_TENANT_TABLES.includes(name)) continue;
    statements.push(
      `ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY`,
      `REVOKE ALL ON "${tableName}" FROM ${APP_ROLE}`,
      `GRANT ${grantsFor(name)} ON "${tableName}" TO ${APP_ROLE}`,
    );
  }
  // Append-only audit: even the owner cannot update/delete rows (defence in depth; 電帳法 訂正削除履歴).
  statements.push(
    `CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$`,
    `DROP TRIGGER IF EXISTS audit_log_immutable_trg ON audit_log`,
    `CREATE TRIGGER audit_log_immutable_trg BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_immutable()`,
  );
  return statements;
}

function grantsFor(name: string): string {
  switch (name) {
    case 'audit_log':
      return 'SELECT, INSERT';
    case 'sequences':
    case 'machine_credentials': // machine-credentials AC-19: keys are revoked, never deleted
      return 'SELECT, INSERT, UPDATE';
    default:
      return 'SELECT, INSERT, UPDATE, DELETE';
  }
}

/** The statements dropAll executes, in order (test databases only). */
export const RESET_STATEMENTS: readonly string[] = Object.freeze([
  'DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;',
  'DROP SCHEMA IF EXISTS drizzle CASCADE;',
]);

/** Drops every registered table (test databases only). */
export async function dropAll(owner: Database): Promise<void> {
  for (const statement of RESET_STATEMENTS) await owner.drizzle.execute(sql.raw(statement));
}
