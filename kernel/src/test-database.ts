// Schema templates for the DB suites (docs/specs/db-test-startup.md). freshDb() used to drop and rebuild the whole
// schema of the test database in every suite. Now the schema built from the current registry is kept as a template
// database keyed by a hash of every statement that builds it, and each freshDb() recreates the dedicated test
// database from that template with CREATE DATABASE ... TEMPLATE. The first suite with a new key builds in place (the
// previous behaviour) and copies the result. Safety: only the database named by TEST_DATABASE_URL_OWNER /
// TEST_DATABASE_URL (both the same, name with a "test" segment) and templates named <db>_tpl_<16 hex> carrying this
// harness's marker for that database are ever created, dropped or changed, and only while the test database holds
// nothing a recreation would lose that the in-place rebuild keeps; anything else rebuilds in place.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { connect, type Database } from './db/client.ts';
import { RESET_STATEMENTS, policyStatements } from './db/migrate.ts';
import { diffSql, emptySnapshot, currentSnapshot } from './db/schema-sync.ts';

/** Part of every key: bump it when the template layout or the meaning of a key changes. */
export const TEMPLATE_FORMAT = 1;
export const TEMPLATE_MARKER = 'daifuku-test-template';
/** Templates kept per test database; the least recently used beyond this are dropped. */
export const DEFAULT_TEMPLATE_LIMIT = 80;
const MAX_IDENTIFIER = 63;
const KEY_LENGTH = 16;
const TEMPLATE_INFIX = '_tpl_';
/** How long a suite waits for sessions of this harness left on the test database before rebuilding in place. */
export const SESSION_WAIT_MS = 15_000;
/** application_name of postgres.js connections: what the test harness, its servers and child processes use. */
export const HARNESS_APPLICATION = 'postgres.js';
const OBJECT_IN_USE = '55006';

export interface SchemaBuild {
  reset: readonly string[];
  ddl: readonly string[];
  policies: readonly string[];
}

/** Every statement that builds the test schema from the current registry, in execution order. */
export async function schemaBuild(): Promise<SchemaBuild> {
  return {
    reset: RESET_STATEMENTS,
    ddl: await diffSql(emptySnapshot(), currentSnapshot()),
    policies: policyStatements(),
  };
}

/** Executes a build statement by statement: what dropAll + createSchemaFromScratch did before templates. */
export async function applySchemaBuild(owner: Database, build: SchemaBuild): Promise<void> {
  for (const statement of [...build.reset, ...build.ddl, ...build.policies])
    await owner.drizzle.execute(sql.raw(statement));
}

export function templateKey(build: SchemaBuild): string {
  return createHash('sha256')
    .update(JSON.stringify({ format: TEMPLATE_FORMAT, reset: build.reset, ddl: build.ddl, policies: build.policies }))
    .digest('hex');
}

export function templateName(database: string, key: string): string {
  return `${database}${TEMPLATE_INFIX}${key.slice(0, KEY_LENGTH)}`;
}

export function templateComment(database: string, key: string, usedAt: Date): string {
  return `${TEMPLATE_MARKER} v${TEMPLATE_FORMAT} db=${database} key=${key} used=${usedAt.toISOString()}`;
}

export interface TemplateMarker {
  format: number;
  database: string;
  key: string;
  usedAt: Date;
}

export function parseTemplateComment(comment: string | null | undefined): TemplateMarker | null {
  const match = new RegExp(`^${TEMPLATE_MARKER} v(\\d+) db=([a-z_][a-z0-9_]*) key=([0-9a-f]{64}) used=(\\S+)$`).exec(
    comment ?? '',
  );
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) return null;
  const usedAt = new Date(match[4]);
  return Number.isNaN(usedAt.getTime())
    ? null
    : { format: Number(match[1]), database: match[2], key: match[3], usedAt };
}

/** True only for a database this harness made for `database`: the exact name shape and a marker naming both. */
export function isOwnTemplate(database: string, name: string, comment: string | null | undefined): boolean {
  const marker = parseTemplateComment(comment);
  return (
    new RegExp(`^${database}${TEMPLATE_INFIX}[0-9a-f]{${KEY_LENGTH}}$`).test(name) &&
    marker?.database === database &&
    templateName(database, marker.key) === name
  );
}

/** Own templates beyond `limit` (counting `keep`), least recently used first; never a foreign or unmarked database. */
export function templatesToDrop(
  database: string,
  rows: readonly { name: string; comment: string | null }[],
  limit: number,
  keep: string,
): string[] {
  return rows
    .filter((row) => row.name !== keep && isOwnTemplate(database, row.name, row.comment))
    .map((row) => ({ name: row.name, usedAt: parseTemplateComment(row.comment)?.usedAt.getTime() ?? 0 }))
    .sort((a, b) => b.usedAt - a.usedAt || a.name.localeCompare(b.name))
    .slice(Math.max(0, limit - 1))
    .map((row) => row.name);
}

export type TemplateTarget =
  | { ok: true; database: string; maintenanceUrl: string; limit: number }
  | { ok: false; reason: string; disabled?: boolean };

/**
 * Decides from the two URLs and the environment whether templates may be used: both roles on one server and one
 * database, no URL query, and a plain lower-case name with a "test" segment short enough for its template names.
 * `ignoreMode` skips TEST_DATABASE_TEMPLATE (the template cleanup command works while templates are off).
 */
export function templateTarget(
  ownerUrl: string,
  appUrl: string,
  env: Record<string, string | undefined>,
  { ignoreMode = false }: { ignoreMode?: boolean } = {},
): TemplateTarget {
  const mode = ignoreMode ? '' : (env.TEST_DATABASE_TEMPLATE ?? '').trim().toLowerCase();
  if (['0', 'off', 'false', 'no'].includes(mode))
    return { ok: false, disabled: true, reason: 'disabled by TEST_DATABASE_TEMPLATE' };
  if (mode && !['1', 'on', 'true', 'yes', 'auto'].includes(mode))
    return { ok: false, reason: `TEST_DATABASE_TEMPLATE=${mode} is not one of auto, on or off` };
  let owner: URL;
  let app: URL;
  try {
    owner = new URL(ownerUrl);
    app = new URL(appUrl);
  } catch {
    return { ok: false, reason: 'TEST_DATABASE_URL_OWNER / TEST_DATABASE_URL are not URLs' };
  }
  if (![owner, app].every((url) => ['postgres:', 'postgresql:'].includes(url.protocol)))
    return { ok: false, reason: 'the test database URLs are not postgres:// URLs' };
  if (owner.search || app.search) return { ok: false, reason: 'the test database URLs carry query parameters' };
  if (owner.host !== app.host) return { ok: false, reason: 'owner and app URLs point to different servers' };
  const database = decodeURIComponent(owner.pathname.slice(1));
  if (database !== decodeURIComponent(app.pathname.slice(1)))
    return { ok: false, reason: 'owner and app URLs name different databases' };
  if (!/^[a-z_][a-z0-9_]*$/.test(database))
    return { ok: false, reason: `the test database name "${database}" is not a plain lower-case identifier` };
  if (!DISPOSABLE_NAME.test(database))
    return {
      ok: false,
      reason: `the database "${database}" does not look disposable (its name lacks a "test" segment)`,
    };
  if (database.length + TEMPLATE_INFIX.length + KEY_LENGTH > MAX_IDENTIFIER)
    return { ok: false, reason: `the database name "${database}" is too long for template names` };
  const limit = Number(env.TEST_DATABASE_TEMPLATE_LIMIT ?? DEFAULT_TEMPLATE_LIMIT);
  if (!Number.isInteger(limit) || limit < 1)
    return { ok: false, reason: 'TEST_DATABASE_TEMPLATE_LIMIT must be a positive integer' };
  const maintenance = new URL(owner.href);
  maintenance.pathname = `/${env.TEST_DATABASE_MAINTENANCE_DB ?? 'postgres'}`;
  if (decodeURIComponent(maintenance.pathname.slice(1)) === database)
    return { ok: false, reason: 'the maintenance database must differ from the test database' };
  return { ok: true, database, maintenanceUrl: maintenance.href, limit };
}

/** A database name with `test` as a whole underscore-separated segment: daifuku_test, daifuku_test_w3, daifuku_ci_test. */
export const DISPOSABLE_NAME = /(?:^|_)test(?:_|$)/;

/**
 * Shard databases of `pnpm gate:light` (docs/specs/light-tier-speed.md): the DB step splits its suites over the test
 * database and <db>_shard_2, <db>_shard_3, ... Mirrors SHARD_INFIX of scripts/gate.mjs (scripts/test/gate.test.ts
 * compares them). Each shard database keeps its own schema templates.
 */
export const SHARD_INFIX = '_shard_';

export function shardDatabaseName(database: string, index: number): string {
  return index === 1 ? database : `${database}${SHARD_INFIX}${index}`;
}

/** True for <database>_shard_<n> with n >= 2: a shard database the tier runner derives from `database`. */
export function isShardDatabase(database: string, name: string): boolean {
  if (!name.startsWith(`${database}${SHARD_INFIX}`)) return false;
  const index = name.slice(database.length + SHARD_INFIX.length);
  return /^[1-9][0-9]*$/.test(index) && Number(index) >= 2;
}

export interface TargetState {
  createdb: boolean;
  exists: boolean;
  owned: boolean;
  defaultAcl: boolean;
  settings: number;
  /** COMMENT ON DATABASE (a shared object that a recreated database does not carry). */
  commented: boolean;
  template: boolean;
  allowConnections: boolean;
  connectionLimit: number;
  /** Same tablespace as template1, where a template built from template1 (and every clone of it) lives. */
  defaultTablespace: boolean;
  /** Encoding and locale equal template1's, so template1 is a pristine base with the same attributes. */
  sameLocaleAsTemplate1: boolean;
}

/** Why the test database cannot be recreated without losing database-level attributes (null when it can). */
export function targetProblem(state: TargetState): string | null {
  if (!state.createdb) return 'the owner role lacks CREATEDB';
  if (!state.exists) return null; // restored from an own template, or reported as missing
  if (!state.owned) return 'the owner role does not own the test database';
  if (!state.defaultAcl) return 'the test database has database-level grants that recreation would drop';
  if (state.settings) return 'the test database has ALTER DATABASE/ROLE settings that recreation would drop';
  if (state.commented) return 'the test database has a comment that recreation would drop';
  if (state.template || !state.allowConnections) return 'the test database is marked as a template or closed';
  if (state.connectionLimit !== -1) return 'the test database has a connection limit that recreation would drop';
  if (!state.defaultTablespace) return 'the test database is not in the default tablespace';
  return null;
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;
const literal = (text: string) => `'${text.replace(/'/g, "''")}'`;

export type TemplateOutcome =
  | { used: 'clone'; template: string; key: string }
  | { used: 'built'; template: string | null; key: string; base: 'template1' | 'in-place'; note?: string }
  | { used: 'legacy'; reason: string };

export interface PrepareOptions {
  now?: () => Date;
  /** How long to wait for sessions of this harness on the test database or a new template (default 15 s). */
  sessionWaitMs?: number;
  /** The statements to build (default: schemaBuild() of the current registry). */
  build?: SchemaBuild;
}

/**
 * Prepares the test database for one suite. Returns an owner connection to it with the schema built and no tenant
 * data, and what happened; `owner: null` (outcome `legacy`) means the caller rebuilds in place, the previous behaviour.
 * Before anything is dropped, the test database must hold nothing that the in-place rebuild keeps and a recreation
 * would lose, and no client other than this harness may be connected to it.
 */
export async function prepareFromTemplate(
  target: Extract<TemplateTarget, { ok: true }>,
  ownerUrl: string,
  options: PrepareOptions = {},
): Promise<{ owner: Database | null; outcome: TemplateOutcome }> {
  const now = options.now ?? (() => new Date());
  const waitMs = options.sessionWaitMs ?? SESSION_WAIT_MS;
  const build = options.build ?? (await schemaBuild());
  const key = templateKey(build);
  const template = templateName(target.database, key);
  const maintenance = connect(target.maintenanceUrl, { max: 1 });
  const exec = (text: string) => maintenance.sql.unsafe(text);
  const mark = () =>
    exec(`COMMENT ON DATABASE ${quote(template)} IS ${literal(templateComment(target.database, key, now()))}`);
  const legacy = (reason: string) => ({ owner: null, outcome: { used: 'legacy' as const, reason } });
  // A database in use (SQLSTATE 55006) is reported as false so that the caller can leave things as they are.
  const unlessInUse = async (text: string) => {
    try {
      await exec(text);
      return true;
    } catch (error) {
      if (errorCode(error) === OBJECT_IN_USE) return false;
      throw error;
    }
  };
  const busy = (database: string) => waitForNoSessions(maintenance, database, waitMs);
  try {
    try {
      await maintenance.sql`select 1`;
    } catch (error) {
      return legacy(`cannot reach the maintenance database (${errorCode(error)})`);
    }
    const state = await readTargetState(maintenance, target.database);
    const problem = targetProblem(state);
    if (problem) return legacy(problem);
    if (state.exists) {
      // Checked on every path: a clone, a template built from template1 and a restore all start from DROP DATABASE.
      const extras = await extraObjects(ownerUrl);
      if (extras.length)
        return legacy(
          `the test database holds objects outside the rebuilt schemas that recreation would drop (${extras.join(', ')})`,
        );
      const blocked = await busy(target.database);
      if (blocked) return legacy(blocked);
    }
    const templates = await listTemplates(maintenance, target.database);
    const current = templates.find((row) => row.name === template);
    const own = current && isOwnTemplate(target.database, current.name, current.comment);
    if (own && parseTemplateComment(current.comment)?.key === key) {
      if (state.exists && !(await unlessInUse(`DROP DATABASE ${quote(target.database)}`)))
        return legacy(`another session connected to ${target.database}`);
      await exec(`CREATE DATABASE ${quote(target.database)} TEMPLATE ${quote(template)}`);
      await mark();
      return { owner: connect(ownerUrl, { max: 2 }), outcome: { used: 'clone', template, key } };
    }
    if (current) {
      // The name embeds this schema's hash, so only this harness makes it. Without any comment its creation was
      // interrupted between CREATE DATABASE and COMMENT; an own template whose full key differs shares only the 16-digit
      // prefix. Both are dropped and rebuilt (unless someone is connected). A database with another comment is left alone.
      if (!own && current.comment !== null)
        return legacy(`database ${template} exists but is not a template of this harness`);
      if (!(await unlessInUse(`DROP DATABASE ${quote(template)}`))) return legacy(`${template} is in use`);
    }
    const finish = async () => {
      await mark();
      await exec(`ALTER DATABASE ${quote(template)} ALLOW_CONNECTIONS false`);
      const rows = await listTemplates(maintenance, target.database);
      // A template in use (another run on the same test database) is kept until a later age-out.
      for (const name of templatesToDrop(target.database, rows, target.limit, template))
        await unlessInUse(`DROP DATABASE IF EXISTS ${quote(name)}`);
    };
    // Build in a fresh copy of template1 (how the test database itself was created) so that the template carries no
    // catalog bloat from earlier rebuilds, then recreate the test database from it like a clone.
    if (
      state.exists &&
      state.sameLocaleAsTemplate1 &&
      (await unlessInUse(`CREATE DATABASE ${quote(template)} TEMPLATE template1`))
    ) {
      const builder = connect(databaseUrl(ownerUrl, template), { max: 1 });
      try {
        await applySchemaBuild(builder, build);
      } catch (error) {
        // An unmarked half-built template would never age out: drop it, keep the build error.
        await builder.close();
        await busy(template).catch(() => null);
        await unlessInUse(`DROP DATABASE IF EXISTS ${quote(template)}`).catch(() => false);
        throw error;
      }
      await builder.close();
      // Marked and closed first, so that even a template still in use below is a valid one for the next suite.
      await finish();
      const templateBlocked = await busy(template);
      if (templateBlocked) return legacy(templateBlocked);
      const blocked = await busy(target.database);
      if (blocked) return legacy(blocked);
      if (!(await unlessInUse(`DROP DATABASE ${quote(target.database)}`)))
        return legacy(`another session connected to ${target.database}`);
      await exec(`CREATE DATABASE ${quote(target.database)} TEMPLATE ${quote(template)}`);
      return { owner: connect(ownerUrl, { max: 2 }), outcome: { used: 'built', template, key, base: 'template1' } };
    }
    if (!state.exists) {
      // An interrupted run stopped between DROP and CREATE: restore from any own template (same locale and owner).
      const any = templates.find((row) => isOwnTemplate(target.database, row.name, row.comment));
      if (!any) return legacy(`the test database ${target.database} does not exist`);
      await exec(`CREATE DATABASE ${quote(target.database)} TEMPLATE ${quote(any.name)}`);
    }
    // Another locale than template1 (or template1 in use), or a database just restored: build in place and copy it.
    const owner = connect(ownerUrl, { max: 2 });
    try {
      await applySchemaBuild(owner, build);
    } finally {
      await owner.close();
    }
    const inPlace = (note: string) => ({
      owner: connect(ownerUrl, { max: 2 }),
      outcome: { used: 'built' as const, template: null, key, base: 'in-place' as const, note },
    });
    const blocked = await busy(target.database);
    if (blocked) return inPlace(blocked);
    if (!(await unlessInUse(`CREATE DATABASE ${quote(template)} TEMPLATE ${quote(target.database)}`)))
      return inPlace(`another session joined ${target.database}`);
    await finish();
    return { owner: connect(ownerUrl, { max: 2 }), outcome: { used: 'built', template, key, base: 'in-place' } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Schema template for ${target.database} failed: ${message}. Set TEST_DATABASE_TEMPLATE=off to rebuild in ` +
        'place (docs/specs/db-test-startup.md).',
      { cause: error },
    );
  } finally {
    await maintenance.close();
  }
}

/** Database-level facts about the test database as seen by the connecting (owner) role. */
export async function readTargetState(maintenance: Database, database: string): Promise<TargetState> {
  const [row] = await maintenance.sql<
    {
      createdb: boolean;
      present: boolean;
      owned: boolean | null;
      default_acl: boolean | null;
      settings: number;
      commented: boolean | null;
      template: boolean | null;
      allow_connections: boolean | null;
      connection_limit: number | null;
      default_tablespace: boolean | null;
      same_locale: boolean | null;
    }[]
  >`select r.rolcreatedb as createdb, d.oid is not null as present, d.datdba = r.oid as owned,
      d.datacl is null as default_acl, d.datistemplate as template, d.datallowconn as allow_connections,
      (select count(*)::int from pg_db_role_setting s where s.setdatabase = d.oid) as settings,
      shobj_description(d.oid, 'pg_database') is not null as commented,
      d.datconnlimit as connection_limit, d.dattablespace = t.dattablespace as default_tablespace,
      (select bool_and((to_jsonb(d) -> k) is not distinct from (to_jsonb(t) -> k))
        from unnest(${LOCALE_COLUMNS}::text[]) as k) as same_locale
    from pg_roles r left join pg_database d on d.datname = ${database}
      left join pg_database t on t.datname = 'template1'
    where r.rolname = current_user`;
  return {
    createdb: Boolean(row?.createdb),
    exists: Boolean(row?.present),
    owned: Boolean(row?.owned),
    defaultAcl: Boolean(row?.default_acl),
    settings: row?.settings ?? 0,
    commented: Boolean(row?.commented),
    template: Boolean(row?.template),
    allowConnections: Boolean(row?.allow_connections),
    connectionLimit: row?.connection_limit ?? -1,
    defaultTablespace: Boolean(row?.default_tablespace),
    sameLocaleAsTemplate1: Boolean(row?.same_locale),
  };
}

// pg_database columns that fix a database's encoding and locale; a column this server version lacks compares equal
// (null on both sides).
const LOCALE_COLUMNS = [
  'encoding',
  'datcollate',
  'datctype',
  'datlocprovider',
  'daticulocale',
  'datlocale',
  'daticurules',
];

// Database-local objects that survive RESET_STATEMENTS (DROP SCHEMA public / drizzle), so the in-place rebuild keeps
// them and DROP DATABASE would lose them: other schemas, extensions besides plpgsql, default privileges, event triggers,
// publications, large objects, foreign-data wrappers and servers, procedural languages and user-defined casts.
export async function extraObjects(ownerUrl: string): Promise<string[]> {
  const probe = connect(ownerUrl, { max: 1 });
  try {
    const [row] = await probe.sql<Record<string, number>[]>`
      select (select count(*)::int from pg_namespace
          where nspname not in ('public', 'drizzle', 'information_schema') and nspname not like 'pg\\_%') as schemas,
        (select count(*)::int from pg_extension where extname <> 'plpgsql') as extensions,
        (select count(*)::int from pg_default_acl) as default_privileges,
        (select count(*)::int from pg_event_trigger) as event_triggers,
        (select count(*)::int from pg_publication) as publications,
        (select count(*)::int from pg_largeobject_metadata) as large_objects,
        (select count(*)::int from pg_foreign_data_wrapper) as foreign_data_wrappers,
        (select count(*)::int from pg_foreign_server) as foreign_servers,
        (select count(*)::int from pg_language where lanname not in ('internal', 'c', 'sql', 'plpgsql')) as languages,
        (select count(*)::int from pg_cast where oid >= 16384) as casts`;
    return Object.entries(row ?? {})
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => `${kind.replace(/_/g, ' ')}: ${count}`);
  } finally {
    await probe.close();
  }
}

/** `url` with its database replaced. */
export function databaseUrl(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.href;
}

/** Databases whose name starts with <database>_tpl_, with their comments (not all of them are own templates). */
export async function listTemplates(
  maintenance: Database,
  database: string,
): Promise<{ name: string; comment: string | null }[]> {
  return maintenance.sql<{ name: string; comment: string | null }[]>`
    select d.datname as name, shobj_description(d.oid, 'pg_database') as comment
    from pg_database d where starts_with(d.datname, ${`${database}${TEMPLATE_INFIX}`}) order by 1`;
}

export interface OwnTemplate {
  name: string;
  usedAt: Date;
  bytes: number;
  /** Set by the cleanup: dropped, or kept because a session was connected to it. */
  dropped?: boolean;
}

/**
 * The own templates of the test database, least recently used first (`pnpm test:db:templates`). With `drop`, each is
 * dropped unless a session is connected to it. Foreign and unmarked databases are never listed, as in the age-out.
 */
export async function ownTemplates(
  target: Extract<TemplateTarget, { ok: true }>,
  { drop = false }: { drop?: boolean } = {},
): Promise<OwnTemplate[]> {
  const maintenance = connect(target.maintenanceUrl, { max: 1 });
  try {
    const rows = await maintenance.sql<{ name: string; comment: string | null; bytes: string }[]>`
      select d.datname as name, shobj_description(d.oid, 'pg_database') as comment,
        pg_database_size(d.oid)::text as bytes
      from pg_database d where starts_with(d.datname, ${`${target.database}${TEMPLATE_INFIX}`}) order by 1`;
    const own = rows
      .filter((row) => isOwnTemplate(target.database, row.name, row.comment))
      .map((row) => ({
        name: row.name,
        usedAt: parseTemplateComment(row.comment)?.usedAt ?? new Date(0),
        bytes: Number(row.bytes),
      }))
      .sort((a, b) => a.usedAt.getTime() - b.usedAt.getTime() || a.name.localeCompare(b.name));
    if (!drop) return own;
    const result: OwnTemplate[] = [];
    for (const template of own) {
      try {
        await maintenance.sql.unsafe(`DROP DATABASE IF EXISTS ${quote(template.name)}`);
        result.push({ ...template, dropped: true });
      } catch (error) {
        if (errorCode(error) !== OBJECT_IN_USE) throw error;
        result.push({ ...template, dropped: false });
      }
    }
    return result;
  } finally {
    await maintenance.close();
  }
}

export interface ShardDatabase {
  name: string;
  bytes: number;
  /** Set by the cleanup: dropped, or kept because a session was connected to it. */
  dropped?: boolean;
}

/**
 * The shard databases of the test database (<db>_shard_<n>, n >= 2) that the connecting owner role owns, by name
 * (`pnpm test:db:templates`). Databases of other roles and other names are never listed. Their schema templates are
 * separate: `ownTemplates` with the shard database as the target.
 */
export async function ownShardDatabases(target: Extract<TemplateTarget, { ok: true }>): Promise<ShardDatabase[]> {
  const maintenance = connect(target.maintenanceUrl, { max: 1 });
  try {
    const rows = await maintenance.sql<{ name: string; bytes: string }[]>`
      select d.datname as name, pg_database_size(d.oid)::text as bytes
      from pg_database d join pg_roles r on r.rolname = current_user and d.datdba = r.oid
      where starts_with(d.datname, ${`${target.database}${SHARD_INFIX}`}) and not d.datistemplate order by 1`;
    return rows
      .filter((row) => isShardDatabase(target.database, row.name))
      .map((row) => ({ name: row.name, bytes: Number(row.bytes) }));
  } finally {
    await maintenance.close();
  }
}

/**
 * Drops one shard database of the test database (`pnpm test:db:templates -- --drop`): true when dropped, false when a
 * session is connected to it (SQLSTATE 55006). Refuses any other name and a database the owner role does not own.
 */
export async function dropShardDatabase(target: Extract<TemplateTarget, { ok: true }>, name: string): Promise<boolean> {
  if (!isShardDatabase(target.database, name)) throw new Error(`${name} is not a shard database of ${target.database}`);
  const maintenance = connect(target.maintenanceUrl, { max: 1 });
  try {
    const [row] = await maintenance.sql<{ owned: boolean }[]>`
      select d.datdba = r.oid as owned from pg_database d join pg_roles r on r.rolname = current_user
      where d.datname = ${name}`;
    if (!row) return true;
    if (!row.owned) throw new Error(`${name} belongs to another role`);
    try {
      await maintenance.sql.unsafe(`DROP DATABASE IF EXISTS ${quote(name)}`);
      return true;
    } catch (error) {
      if (errorCode(error) !== OBJECT_IN_USE) throw error;
      return false;
    }
  } finally {
    await maintenance.close();
  }
}

// Null once no client session is connected to `database`, else why not. Sessions of this harness (postgres.js: the
// previous suite's pools, its servers and child processes) are waited for up to `waitMs`; any other client (psql, a GUI)
// makes it give up at once, because it would make every suite wait. Autovacuum workers have no role and are not
// counted: DROP DATABASE and CREATE DATABASE stop them.
async function waitForNoSessions(maintenance: Database, database: string, waitMs: number): Promise<string | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const rows = await maintenance.sql<{ application: string }[]>`
      select coalesce(application_name, '') as application from pg_stat_activity
      where datname = ${database} and usesysid is not null and pid <> pg_backend_pid()`;
    if (!rows.length) return null;
    const foreign = [...new Set(rows.map((row) => row.application).filter((name) => name !== HARNESS_APPLICATION))];
    if (foreign.length)
      return `another client is connected to ${database} (application_name ${foreign
        .map((name) => JSON.stringify(name))
        .join(', ')})`;
    if (Date.now() > deadline) return `sessions of this harness still use ${database} after ${waitMs} ms`;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function errorCode(error: unknown): string {
  const value = (error as { code?: unknown } | null)?.code;
  return typeof value === 'string' && /^[A-Z0-9_]+$/.test(value) ? value : 'connection failed';
}
