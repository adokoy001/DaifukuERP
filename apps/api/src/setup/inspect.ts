import { createHash } from 'node:crypto';
import { connect, type Database } from '@daifuku/kernel';
import { loadRuntime } from '@daifuku/runtime';
import { join } from 'node:path';
import { catalogHash, checkColumns, checkHistory, history, migrationCatalog } from './catalog.ts';
import { readState } from './files.ts';
import { connection, readSecrets } from './options.ts';
import { SetupError, type SetupOptions, type SetupPlan, type SetupSecrets, type Target } from './types.ts';
import { MIGRATIONS_DIR } from '../db/migrations.ts';

export async function inspectTarget(db: Database, url: string): Promise<Target> {
  const parsed = connection(url, true);
  const rows = await db.sql<{ database: string; oid: string; owner: string; username: string; superuser: boolean; bypass: boolean; version: string; address: string; port: string; read_only: boolean }[]>`
    select current_database() as database, d.oid::text, pg_get_userbyid(d.datdba) as owner, current_user as username,
      r.rolsuper as superuser, r.rolbypassrls as bypass, current_setting('server_version_num') as version,
      host(inet_server_addr()) as address, inet_server_port()::text as port,
      (pg_is_in_recovery() or current_setting('transaction_read_only')='on') as read_only
    from pg_database d join pg_roles r on r.rolname=current_user where d.datname=current_database()`;
  const row = rows[0];
  if (!row || row.username !== row.owner || !row.bypass || row.superuser) throw new SetupError('OWNER_ROLE', 'ownerはDB所有者・BYPASSRLSで、superuser以外の専用roleにしてください。');
  if (Number(row.version) < 160000) throw new SetupError('POSTGRES_VERSION', 'PostgreSQL16以上が必要です。');
  if (row.read_only) throw new SetupError('READ_ONLY_TARGET', '待機系または読取専用DBへは導入・更新できません。');
  const host = row.address ?? parsed.hostname, port = row.port ?? parsed.port ?? '5432';
  const id = createHash('sha256').update(JSON.stringify([host, port, row.database, row.oid, row.owner])).digest('hex').slice(0, 24);
  return { id, database: row.database, host, port, owner: row.owner, postgres: Number(row.version) };
}
async function checkApp(secrets: SetupSecrets, target: Target): Promise<void> {
  const app = connect(secrets.appUrl, { max: 1 });
  try {
    const rows = await app.sql<{ username: string; database: string; bad: boolean; owner_member: boolean; can_create: boolean }[]>`
      select current_user as username, current_database() as database,
        (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication
          or exists (select 1 from pg_roles inherited where inherited.rolname <> current_user and pg_has_role(current_user,inherited.oid,'MEMBER')
            and (inherited.rolsuper or inherited.rolbypassrls or inherited.rolcreatedb or inherited.rolcreaterole or inherited.rolreplication or inherited.rolname like 'pg\\_%')))
          as bad,
        pg_has_role(current_user, ${target.owner}, 'MEMBER') as owner_member,
        has_schema_privilege(current_user,'public','CREATE') as can_create from pg_roles where rolname=current_user`;
    const row = rows[0];
    if (!row || row.username !== 'daifuku_app' || row.database !== target.database || row.bad || row.owner_member || row.can_create) throw new SetupError('APP_ROLE', 'appはdaifuku_app専用roleで、所有者・管理権限・public CREATE・owner継承を持たない必要があります。');
  } finally { await app.close(); }
}
export async function relationNames(db: Database): Promise<string[]> {
  const rows = await db.sql<{ schema: string; name: string }[]>`select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and c.relkind in ('r','p','v','m','S','f') order by n.nspname,c.relname`;
  return rows.map((row) => `${row.schema}.${row.name}`);
}
export async function otherConnections(db: Database): Promise<number> {
  const rows = await db.sql`select count(*)::int as count from pg_stat_activity where datname=current_database() and pid <> pg_backend_pid()`;
  return Number(rows[0]?.count ?? 0);
}
async function inspectRestore(secrets: SetupSecrets, target: Target): Promise<{ label: string | null; empty: boolean }> {
  if (!secrets.restoreUrl) return { label: null, empty: false };
  const restore = connect(secrets.restoreUrl, { max: 1 });
  try {
    const rt = await inspectTarget(restore, secrets.restoreUrl);
    if (rt.id === target.id || (rt.host === target.host && rt.port === target.port && rt.database === target.database)) throw new SetupError('RESTORE_SAME_TARGET', '復元確認先を導入先と同じDBにはできません。');
    return { label: `${rt.host}:${rt.port}/${rt.database}`, empty: (await relationNames(restore)).length === 0 && await otherConnections(restore) === 0 };
  } finally { await restore.close(); }
}
export async function buildPlan(options: SetupOptions, dir = MIGRATIONS_DIR, selectedSecrets?: SetupSecrets): Promise<SetupPlan> {
  await loadRuntime({ schema: true });
  const secrets = selectedSecrets ?? await readSecrets(options), catalog = await migrationCatalog(dir), state = await readState(options.stateDir);
  const owner = connect(secrets.ownerUrl, { max: 1 });
  try {
    const target = await inspectTarget(owner, secrets.ownerUrl);
    if (state && state.targetId !== target.id) throw new SetupError('STATE_TARGET', 'checkpointは別のDBを指しています。流用・上書きできません。');
    if (state && state.phase !== 'complete' && state.operationMode !== options.mode) throw new SetupError('STATE_MODE', '未完了の導入・更新は同じmodeで再開してください。管理者作成や移行を飛ばして完了扱いにはしません。');
    await checkApp(secrets, target);
    const applied = await history(owner); checkHistory(applied, catalog);
    const relations = await relationNames(owner), empty = relations.every((name) => ['drizzle.__drizzle_migrations', 'drizzle.__drizzle_migrations_id_seq'].includes(name));
    if ((!empty && !applied.length) || (options.mode === 'install' && !empty && !state?.identity)) throw new SetupError('EXISTING_DATABASE', '新規導入先が空ではないか、既知の移行履歴がありません。resetや自動採用は行いません。');
    if (options.mode === 'upgrade' && !applied.length) throw new SetupError('NOT_INSTALLED', '更新対象に大福の移行履歴がありません。');
    await checkColumns(owner, applied.length, dir);
    const restore = await inspectRestore(secrets, target);
    const digest = catalogHash(catalog);
    return { mode: options.mode, target, empty, applied: applied.length, pending: catalog.slice(applied.length).map((file) => file.tag), migrationHash: digest, backupDirectory: join(options.stateDir, 'backups'), restoreTarget: restore.label, restoreEmpty: restore.empty, otherConnections: await otherConnections(owner), noOp: state?.phase === 'complete' && state.completedHash === digest && applied.length === catalog.length };
  } finally { await owner.close(); }
}
