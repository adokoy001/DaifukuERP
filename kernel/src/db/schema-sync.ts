// Schema generation from the registry via drizzle-kit's programmatic API.
// Used by tests (fresh DB) and by scripts/db-generate to write migration files.
import { sql } from 'drizzle-orm';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { registry } from '../registry.ts';
import type { Database } from './client.ts';
import { enforcePolicies } from './migrate.ts';

export type Snapshot = ReturnType<typeof generateDrizzleJson>;

export function currentSnapshot(prevId?: string): Snapshot {
  return generateDrizzleJson(registry.tables(), prevId);
}

export function emptySnapshot(): Snapshot {
  return generateDrizzleJson({});
}

export async function diffSql(prev: Snapshot, cur: Snapshot): Promise<string[]> {
  return generateMigration(prev as never, cur as never);
}

/** Test/dev only: creates all registered tables in an empty database and applies policies. */
export async function createSchemaFromScratch(owner: Database): Promise<string[]> {
  const statements = await diffSql(emptySnapshot(), currentSnapshot());
  for (const s of statements) await owner.drizzle.execute(sql.raw(s));
  await enforcePolicies(owner);
  return statements;
}
