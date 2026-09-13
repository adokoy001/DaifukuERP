import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { connect, type Database } from '@daifuku/kernel';
import { privateDirectory, writeExclusive } from './files.ts';
import { history } from './catalog.ts';
import { inspectTarget, otherConnections, relationNames } from './inspect.ts';
import { pgTool } from './pg-tools.ts';
import { SetupError, type SetupSecrets, type Target } from './types.ts';

export async function tableCounts(db: Pick<Database, 'sql'>): Promise<Record<string, string>> {
  const tables = await db.sql<
    { schema: string; name: string }[]
  >`select schemaname as schema, tablename as name from pg_tables where schemaname not in ('pg_catalog','information_schema') order by schemaname,tablename`;
  const counts: Record<string, string> = {};
  for (const table of tables) {
    const rows = await db.sql`select count(*)::text as count from ${db.sql(table.schema)}.${db.sql(table.name)}`;
    counts[`${table.schema}.${table.name}`] = String(rows[0]?.count);
  }
  return counts;
}
async function checksum(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
/** Preserves the verified restore database. Never creates, clears or drops any database. */
export async function backupAndVerify(
  owner: Database,
  secrets: SetupSecrets,
  target: Target,
  directory: string,
): Promise<string> {
  if (!secrets.restoreUrl)
    throw new SetupError('RESTORE_REQUIRED', 'RESTORE_CHECK_URLで専用の空DBを指定してください。');
  await privateDirectory(directory);
  const restore = connect(secrets.restoreUrl, { max: 1 });
  const path = join(
    directory,
    `${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(8).toString('hex')}.dump`,
  );
  try {
    const destination = await inspectTarget(restore, secrets.restoreUrl);
    if (destination.id === target.id || (await relationNames(restore)).length || (await otherConnections(restore)))
      throw new SetupError('RESTORE_NOT_EMPTY', '復元確認先は導入先とは別の空DBで、他の接続がない必要があります。');
    await writeExclusive(path, '');
    let expected: Record<string, string> = {};
    // pg_dump and row counts observe the same exported PostgreSQL snapshot.
    await owner.sql.begin('isolation level repeatable read read only', async (tx) => {
      const snapshot = await tx`select pg_export_snapshot() as id`;
      expected = await tableCounts({ sql: tx as unknown as Database['sql'] });
      await pgTool(
        'pg_dump',
        secrets.ownerUrl,
        ['--format=custom', '--no-password', '--file', path, `--snapshot=${String(snapshot[0]?.id)}`],
        directory,
      );
    });
    await chmod(path, 0o600);
    const beforeHistory = await history(owner);
    const database = decodeURIComponent(new URL(secrets.restoreUrl).pathname.slice(1))
      .replaceAll('\\', '\\\\')
      .replaceAll("'", "\\'");
    await pgTool(
      'pg_restore',
      secrets.restoreUrl,
      ['--no-owner', '--no-privileges', '--exit-on-error', '--no-password', '--dbname', `dbname='${database}'`, path],
      directory,
    );
    const actual = await tableCounts(restore);
    const restoredHistory = await history(restore);
    if (
      JSON.stringify(expected) !== JSON.stringify(actual) ||
      JSON.stringify(beforeHistory) !== JSON.stringify(restoredHistory)
    )
      throw new SetupError(
        'RESTORE_MISMATCH',
        '復元した表件数または移行履歴が一致しません。対象の更新は開始しません。',
      );
    const manifest = {
      format: 1,
      target,
      restore: { database: destination.database, host: destination.host, port: destination.port },
      verifiedAt: new Date().toISOString(),
      sha256: await checksum(path),
      tableCounts: expected,
      migrationHistory: beforeHistory,
    };
    await writeExclusive(`${path}.verified.json`, `${JSON.stringify(manifest, null, 2)}\n`);
    return path;
  } finally {
    await restore.close();
  }
}
