// Schema templates for the DB suites (docs/specs/db-test-startup.md). freshDb() used to drop and rebuild the whole
// schema of the test database in every suite. Now the schema built from the current registry is kept as a template
// database keyed by a hash of every statement that builds it, and each freshDb() recreates the dedicated test
// database from that template with CREATE DATABASE ... TEMPLATE. The first suite with a new key builds in place (the
// previous behaviour) and copies the result. Safety: only the database named by TEST_DATABASE_URL_OWNER /
// TEST_DATABASE_URL (both the same, name containing "test") and templates named <db>_tpl_<16 hex> carrying this
// harness's marker for that database are ever created, dropped or changed; anything else rebuilds in place.
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
const SESSION_WAIT_MS = 15_000;
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
 * database, no URL query, and a plain lower-case name containing "test" short enough for its template names.
 */
export function templateTarget(
  ownerUrl: string,
  appUrl: string,
  env: Record<string, string | undefined>,
): TemplateTarget {
  const mode = (env.TEST_DATABASE_TEMPLATE ?? '').trim().toLowerCase();
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
  if (!database.includes('test'))
    return { ok: false, reason: `the database "${database}" does not look disposable (its name lacks "test")` };
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

export interface TargetState {
  createdb: boolean;
  exists: boolean;
  owned: boolean;
  defaultAcl: boolean;
  settings: number;
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

/**
 * Prepares the test database for one suite. Returns an owner connection to it with the schema built and no tenant
 * data, and what happened; `owner: null` (outcome `legacy`) means the caller rebuilds in place, the previous behaviour.
 */
export async function prepareFromTemplate(
  target: Extract<TemplateTarget, { ok: true }>,
  ownerUrl: string,
  now: () => Date = () => new Date(),
): Promise<{ owner: Database | null; outcome: TemplateOutcome }> {
  const build = await schemaBuild();
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
  try {
    try {
      await maintenance.sql`select 1`;
    } catch (error) {
      return legacy(`cannot reach the maintenance database (${errorCode(error)})`);
    }
    const state = await readTargetState(maintenance, target.database);
    const problem = targetProblem(state);
    if (problem) return legacy(problem);
    const templates = await listTemplates(maintenance, target.database);
    const current = templates.find((row) => row.name === template);
    const own = current && isOwnTemplate(target.database, current.name, current.comment);
    if (own && parseTemplateComment(current.comment)?.key === key) {
      if (!(await waitForNoSessions(maintenance, target.database)))
        return legacy(`other sessions still use ${target.database}`);
      if (state.exists && !(await unlessInUse(`DROP DATABASE ${quote(target.database)}`)))
        return legacy(`another session connected to ${target.database}`);
      await exec(`CREATE DATABASE ${quote(target.database)} TEMPLATE ${quote(template)}`);
      await mark();
      return { owner: connect(ownerUrl, { max: 2 }), outcome: { used: 'clone', template, key } };
    }
    if (current) {
      // The name embeds this schema's hash, so only this harness makes it. Without any comment its creation was
      // interrupted between CREATE DATABASE and COMMENT; an own template whose full key differs shares only the 16-digit
      // prefix. Both are dropped and rebuilt. A database with another comment is left alone.
      if (!own && current.comment !== null)
        return legacy(`database ${template} exists but is not a template of this harness`);
      await exec(`DROP DATABASE ${quote(template)}`);
    }
    const finish = async () => {
      await mark();
      await exec(`ALTER DATABASE ${quote(template)} ALLOW_CONNECTIONS false`);
      const rows = await listTemplates(maintenance, target.database);
      for (const name of templatesToDrop(target.database, rows, target.limit, template))
        await exec(`DROP DATABASE IF EXISTS ${quote(name)}`);
    };
    // Build in a fresh copy of template1 (how the test database itself was created) so that the template carries no
    // catalog bloat from earlier rebuilds, then recreate the test database from it like a clone.
    if (
      state.exists &&
      state.sameLocaleAsTemplate1 &&
      !(await holdsExtraObjects(ownerUrl)) &&
      (await unlessInUse(`CREATE DATABASE ${quote(template)} TEMPLATE template1`))
    ) {
      const builder = connect(databaseUrl(ownerUrl, template), { max: 1 });
      try {
        await applySchemaBuild(builder, build);
      } finally {
        await builder.close();
      }
      if (!(await waitForNoSessions(maintenance, template))) return legacy(`other sessions use ${template}`);
      await finish();
      if (!(await waitForNoSessions(maintenance, target.database)))
        return legacy(`other sessions still use ${target.database}`);
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
    // Another locale than template1, or objects outside the rebuilt schemas: build in place and copy the database.
    const owner = connect(ownerUrl, { max: 2 });
    try {
      await applySchemaBuild(owner, build);
    } finally {
      await owner.close();
    }
    if (!(await waitForNoSessions(maintenance, target.database)))
      return {
        owner: connect(ownerUrl, { max: 2 }),
        outcome: {
          used: 'built',
          template: null,
          key,
          base: 'in-place',
          note: `other sessions still use ${target.database}`,
        },
      };
    if (!(await unlessInUse(`CREATE DATABASE ${quote(template)} TEMPLATE ${quote(target.database)}`)))
      return {
        owner: connect(ownerUrl, { max: 2 }),
        outcome: {
          used: 'built',
          template: null,
          key,
          base: 'in-place',
          note: `another session joined ${target.database}`,
        },
      };
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
      template: boolean | null;
      allow_connections: boolean | null;
      connection_limit: number | null;
      default_tablespace: boolean | null;
      same_locale: boolean | null;
    }[]
  >`select r.rolcreatedb as createdb, d.oid is not null as present, d.datdba = r.oid as owned,
      d.datacl is null as default_acl, d.datistemplate as template, d.datallowconn as allow_connections,
      (select count(*)::int from pg_db_role_setting s where s.setdatabase = d.oid) as settings,
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

// Schemas besides public/drizzle or extensions besides plpgsql in the test database (the in-place rebuild keeps them).
async function holdsExtraObjects(ownerUrl: string): Promise<boolean> {
  const probe = connect(ownerUrl, { max: 1 });
  try {
    const [row] = await probe.sql<{ schemas: number; extensions: number }[]>`
      select (select count(*)::int from pg_namespace
          where nspname not in ('public', 'drizzle', 'information_schema') and nspname not like 'pg\\_%') as schemas,
        (select count(*)::int from pg_extension where extname <> 'plpgsql') as extensions`;
    return Boolean(row?.schemas || row?.extensions);
  } finally {
    await probe.close();
  }
}

function databaseUrl(url: string, database: string): string {
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

async function waitForNoSessions(maintenance: Database, database: string): Promise<boolean> {
  const deadline = Date.now() + SESSION_WAIT_MS;
  for (;;) {
    const [row] = await maintenance.sql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity where datname = ${database} and pid <> pg_backend_pid()`;
    if (!row?.n) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function errorCode(error: unknown): string {
  const value = (error as { code?: unknown } | null)?.code;
  return typeof value === 'string' && /^[A-Z0-9_]+$/.test(value) ? value : 'connection failed';
}
