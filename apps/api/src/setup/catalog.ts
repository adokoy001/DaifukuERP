import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '@daifuku/kernel';
import { MIGRATIONS_DIR, pendingMigration, readJournal } from '../db/migrations.ts';
import { SetupError, type MigrationFile } from './types.ts';

export async function migrationCatalog(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const journal = readJournal(dir);
  const files: MigrationFile[] = [];
  for (const [index, entry] of journal.entries.entries()) {
    if (
      entry.idx !== index ||
      !/^\d{4}_[a-z0-9_]+$/.test(entry.tag) ||
      !Number.isSafeInteger(entry.when) ||
      entry.when <= (files.at(-1)?.when ?? 0)
    )
      throw new SetupError('MIGRATION_JOURNAL', '移行journalの連番・名前・時刻が不正です。');
    const sql = await readFile(join(dir, `${entry.tag}.sql`), 'utf8');
    files.push({ idx: index, tag: entry.tag, when: entry.when, hash: createHash('sha256').update(sql).digest('hex') });
  }
  if (!files.length) throw new SetupError('MIGRATION_EMPTY', '適用する移行ファイルがありません。');
  const pending = await pendingMigration(dir);
  if (pending.statements.length)
    throw new SetupError(
      'UNRELEASED_SCHEMA',
      '登録schemaと移行snapshotが一致しません。移行を別途レビュー・生成してから導入してください。',
    );
  return files;
}
export async function history(db: Database): Promise<{ hash: string; created_at: string }[]> {
  const found = await db.sql`select to_regclass('drizzle.__drizzle_migrations') as table_name`;
  if (!found[0]?.table_name) return [];
  return db.sql<
    { hash: string; created_at: string }[]
  >`select hash, created_at::text from drizzle.__drizzle_migrations order by id`;
}
export function checkHistory(applied: { hash: string; created_at: string }[], catalog: MigrationFile[]): void {
  if (
    applied.length > catalog.length ||
    applied.some(
      (entry, index) => entry.hash !== catalog[index]?.hash || entry.created_at !== String(catalog[index]?.when),
    )
  )
    throw new SetupError(
      'MIGRATION_HISTORY',
      '適用済み移行が配布ファイルと一致しないか、DBがこの版より新しいため拒否しました。',
    );
}
export async function checkColumns(db: Database, applied: number, dir = MIGRATIONS_DIR): Promise<void> {
  if (!applied) return;
  const raw = JSON.parse(
    await readFile(join(dir, 'meta', `${String(applied - 1).padStart(4, '0')}_snapshot.json`), 'utf8'),
  ) as { tables: Record<string, { name: string; columns: Record<string, { type: string; notNull: boolean }> }> };
  const actual = await db.sql<{ table_name: string; column_name: string; type: string; not_null: boolean }[]>`
    select c.relname as table_name, a.attname as column_name, format_type(a.atttypid,a.atttypmod) as type, a.attnotnull as not_null
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    where n.nspname='public' and c.relkind in ('r','p','v','m','f') and a.attnum>0 and not a.attisdropped`;
  const signature = (type: string, notNull: boolean) =>
    `${type.replaceAll(/\s/g, '').replace(/^serial$/, 'integer')}|${notNull}`;
  const seen = new Map(
    actual.map((row) => [`${row.table_name}.${row.column_name}`, signature(row.type, row.not_null)]),
  );
  const expected = new Map(
    Object.values(raw.tables).flatMap((table) =>
      Object.entries(table.columns).map(([name, column]) => [
        `${table.name}.${name}`,
        signature(column.type, column.notNull),
      ]),
    ),
  );
  if (expected.size !== seen.size || [...expected].some(([name, type]) => seen.get(name) !== type))
    throw new SetupError(
      'SCHEMA_DRIFT',
      'DBの表・列・型・NULL制約が適用済snapshotと一致しません。移行履歴だけを信用して更新しません。',
    );
}
export const catalogHash = (catalog: MigrationFile[]) =>
  createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
