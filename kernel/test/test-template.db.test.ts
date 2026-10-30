// db-test-startup (docs/specs/db-test-startup.md) on the real server: a suite gets exactly the catalog of the
// in-place rebuild whether freshDb() rebuilt the schema, built a new template or cloned an existing one (relations,
// columns, constraints, indexes, RLS flags, policies, grants, triggers, functions, schemas, types, extensions, default
// privileges and database-level attributes); a test database holding objects outside the rebuilt schemas is never
// dropped; templates are marked and closed to connections; the age-out and cleanup listings never offer a foreign
// database; an owner without CREATEDB is refused; sessions left on the test database or a template make it rebuild in
// place without dropping anything; a missing test database is restored or reported; unexpected failures name the way
// out and leave no half-built template.
// This suite creates and drops only the test database and databases named <test db>_tpl_* (docs/conventions/testing.md).
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { connect, type Database } from '../src/db/client.ts';
import { RESET_STATEMENTS } from '../src/db/migrate.ts';
import { APP_URL, OWNER_URL, freshDb, schemaPreparation } from '../src/testing.ts';
import {
  databaseUrl,
  isOwnTemplate,
  listTemplates,
  ownTemplates,
  parseTemplateComment,
  prepareFromTemplate,
  readTargetState,
  schemaBuild,
  targetProblem,
  templateKey,
  templateName,
  templateTarget,
  templatesToDrop,
} from '../src/test-database.ts';
import './fixtures/entities.ts';
import './noninterference-fixture.ts';

const saved = process.env.TEST_DATABASE_TEMPLATE;
const target = templateTarget(OWNER_URL, APP_URL, { ...process.env, TEST_DATABASE_TEMPLATE: 'auto' });
const maintenanceUrl = target.ok ? target.maintenanceUrl : null;
const decoys: string[] = [];
afterAll(async () => {
  if (saved === undefined) delete process.env.TEST_DATABASE_TEMPLATE;
  else process.env.TEST_DATABASE_TEMPLATE = saved;
  if (maintenanceUrl && decoys.length) {
    const maintenance = connect(maintenanceUrl, { max: 1 });
    for (const name of decoys) await maintenance.sql.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
    await maintenance.close();
  }
});

function ready() {
  if (!target.ok) throw new Error(target.reason);
  return target;
}

async function withMaintenance<T>(fn: (maintenance: Database) => Promise<T>): Promise<T> {
  const maintenance = connect(ready().maintenanceUrl, { max: 1 });
  try {
    return await fn(maintenance);
  } finally {
    await maintenance.close();
  }
}

// The database's OID (it changes when the database is dropped and created again), or null when it does not exist.
const oidOf = (name: string) =>
  withMaintenance(async (maintenance) => {
    const [row] = await maintenance.sql<
      { oid: string }[]
    >`select oid::text as oid from pg_database where datname = ${name}`;
    return row?.oid ?? null;
  });

// freshDb() whose connections are closed even when an expectation fails (a session left open would make every later
// freshDb() of this file wait for it).
async function withFreshDb<T>(fn: (db: Awaited<ReturnType<typeof freshDb>>) => Promise<T>): Promise<T> {
  const db = await freshDb();
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

// Makes sure the template of the current registry exists (built or cloned) and no harness session is left open.
async function ensureTemplate() {
  process.env.TEST_DATABASE_TEMPLATE = 'auto';
  await withFreshDb(async () => undefined);
  const key = templateKey(await schemaBuild());
  return { key, name: templateName(ready().database, key) };
}

// Everything the app and owner roles can observe about the schema, without OIDs.
async function catalog(db: Database) {
  const user = `not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'`;
  const q = (text: string) => db.sql.unsafe(text);
  return {
    relations:
      await q(`select n.nspname, c.relname, c.relkind, c.relpersistence, c.relrowsecurity, c.relforcerowsecurity,
        c.relacl::text as acl, pg_get_userbyid(c.relowner) as owner
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname ${user} order by 1, 2`),
    columns: await q(`select table_schema, table_name, column_name, ordinal_position, data_type, udt_name, is_nullable,
        column_default, is_generated, generation_expression, character_maximum_length, numeric_precision, numeric_scale
      from information_schema.columns where table_schema not in ('pg_catalog', 'information_schema') order by 1, 2, 4`),
    constraints:
      await q(`select c.conrelid::regclass::text as rel, c.conname, c.contype, pg_get_constraintdef(c.oid) as def
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname ${user} order by 1, 2`),
    indexes: await q(`select schemaname, tablename, indexname, indexdef from pg_indexes
      where schemaname not in ('pg_catalog', 'information_schema') order by 1, 2, 3`),
    policies: await q(`select schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check
      from pg_policies order by 1, 2, 3`),
    triggers: await q(`select t.tgrelid::regclass::text as rel, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) as def
      from pg_trigger t where not t.tgisinternal order by 1, 2`),
    functions: await q(`select n.nspname, p.proname, pg_get_functiondef(p.oid) as def, p.proacl::text as acl,
        pg_get_userbyid(p.proowner) as owner
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname ${user} order by 1, 2, 3`),
    schemas: await q(`select n.nspname, pg_get_userbyid(n.nspowner) as owner, n.nspacl::text as acl
      from pg_namespace n where n.nspname ${user} order by 1`),
    types: await q(`select n.nspname, t.typname, t.typtype from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname ${user} order by 1, 2`),
    extensions: await q(
      `select extname, extversion, extnamespace::regnamespace::text as schema from pg_extension order by 1`,
    ),
    defaultAcl: await q(`select defaclrole::regrole::text as role, defaclnamespace::regnamespace::text as schema,
        defaclobjtype, defaclacl::text as acl from pg_default_acl order by 1, 2, 3`),
    database: await q(`select current_database() as name, pg_get_userbyid(d.datdba) as owner,
        pg_encoding_to_char(d.encoding) as encoding, d.datcollate, d.datctype, d.datlocprovider, d.datacl::text as acl,
        d.datconnlimit, d.datallowconn, d.datistemplate,
        (select count(*)::int from pg_db_role_setting s where s.setdatabase = d.oid) as settings
      from pg_database d where d.datname = current_database()`),
    appPrivileges: await q(`select c.relname,
        has_table_privilege('daifuku_app', c.oid, 'SELECT') as s, has_table_privilege('daifuku_app', c.oid, 'INSERT') as i,
        has_table_privilege('daifuku_app', c.oid, 'UPDATE') as u, has_table_privilege('daifuku_app', c.oid, 'DELETE') as d
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`),
    rows: await q(`select count(*)::int as n from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'`),
  };
}

// Rebuilds in place (templates off), optionally adds something to the test database, then lets freshDb() build a new
// template for this registry and clone it; returns the catalogs and outcomes. Starts cold by dropping this key's own
// template when an earlier run left one.
async function roundTrip(afterLegacy: (owner: Database) => Promise<unknown> = async () => undefined) {
  if (!target.ok) throw new Error(target.reason);
  const key = templateKey(await schemaBuild());
  const name = templateName(target.database, key);
  const maintenance = connect(target.maintenanceUrl, { max: 1 });
  try {
    const existing = (await listTemplates(maintenance, target.database)).find((row) => row.name === name);
    if (existing) {
      expect(isOwnTemplate(target.database, existing.name, existing.comment)).toBe(true);
      await maintenance.sql.unsafe(`DROP DATABASE "${name}"`);
    }
  } finally {
    await maintenance.close();
  }
  process.env.TEST_DATABASE_TEMPLATE = 'off';
  const legacy = await freshDb();
  expect(schemaPreparation()).toEqual({ used: 'legacy', reason: 'disabled by TEST_DATABASE_TEMPLATE' });
  await afterLegacy(legacy.owner);
  const expected = await catalog(legacy.owner);
  await legacy.close();
  process.env.TEST_DATABASE_TEMPLATE = 'auto';
  const built = await freshDb();
  const builtOutcome = schemaPreparation();
  const builtCatalog = await catalog(built.owner);
  await built.close();
  const cloned = await freshDb();
  const clonedOutcome = schemaPreparation();
  const clonedCatalog = await catalog(cloned.owner);
  return { key, name, expected, builtOutcome, builtCatalog, cloned, clonedOutcome, clonedCatalog };
}

describe('db-test-startup schema templates on the real server', () => {
  it('AC-1 AC-2 AC-3 an in-place rebuild, a template built from template1 and its clone give the same catalog', async () => {
    expect(target.ok, target.ok ? '' : target.reason).toBe(true);
    const run = await roundTrip();
    expect(run.expected.relations.some((row) => row.relname === 'pv_scope_work' && row.relforcerowsecurity)).toBe(true);
    expect(run.expected.triggers.some((row) => row.tgname === 'audit_log_immutable_trg')).toBe(true);
    // A plain test database (created like daifuku_test / daifuku_ci_test) is rebuilt from template1.
    expect(run.builtOutcome).toEqual({ used: 'built', template: run.name, key: run.key, base: 'template1' });
    expect(run.builtCatalog).toEqual(run.expected);
    expect(run.clonedOutcome).toEqual({ used: 'clone', template: run.name, key: run.key });
    expect(run.clonedCatalog).toEqual(run.expected);
    // The clone is a working test database: the bootstrap tenant exists and the app role is subject to RLS.
    const [all] = await run.cloned.owner.sql`select count(*)::int as n from companies`;
    expect(all?.n).toBe(1);
    const [visible] = await run.cloned.app.sql`select count(*)::int as n from companies`;
    expect(visible?.n).toBe(0);
    expect(await run.cloned.run({}, async (ctx) => ctx.companyId)).toBe(run.cloned.companyId);
    await run.cloned.close();
  });

  it.each([
    [
      'an extra schema',
      'CREATE SCHEMA tpl_probe_extra; CREATE TABLE tpl_probe_extra.kept (id int)',
      'DROP SCHEMA IF EXISTS tpl_probe_extra CASCADE',
      /schemas: 1/,
    ],
    [
      'default privileges',
      'ALTER DEFAULT PRIVILEGES FOR ROLE {owner} GRANT SELECT ON TABLES TO daifuku_app',
      'ALTER DEFAULT PRIVILEGES FOR ROLE {owner} REVOKE SELECT ON TABLES FROM daifuku_app',
      /default privileges: 1/,
    ],
  ])(
    'AC-2 AC-3 AC-4 a test database holding %s is rebuilt in place on every path and never dropped, keeping it',
    async (_label, add, remove, reason) => {
      const owner = new URL(OWNER_URL).username;
      // A template of this registry exists, so without the object the next suite would clone.
      await ensureTemplate();
      process.env.TEST_DATABASE_TEMPLATE = 'off';
      try {
        await withFreshDb((setup) => setup.owner.sql.unsafe(add.replace('{owner}', owner)));
        const expected = await withFreshDb((legacy) => catalog(legacy.owner));
        const before = await oidOf(ready().database);
        process.env.TEST_DATABASE_TEMPLATE = 'auto';
        await withFreshDb(async (kept) => {
          expect(schemaPreparation()).toEqual({ used: 'legacy', reason: expect.stringMatching(reason) });
          expect(await catalog(kept.owner)).toEqual(expected);
        });
        expect(await oidOf(ready().database)).toBe(before);
      } finally {
        // Even after a failure: a leftover object would send every later suite to the in-place rebuild.
        process.env.TEST_DATABASE_TEMPLATE = 'auto';
        const cleanup = connect(OWNER_URL, { max: 1 });
        try {
          await cleanup.sql.unsafe(remove.replace('{owner}', owner));
        } finally {
          await cleanup.close();
        }
      }
      // Without the object the template path is back (and the next suites get a plain test database).
      await withFreshDb(async () => expect(schemaPreparation()).toMatchObject({ used: 'clone' }));
    },
  );

  it('AC-2 AC-4 a template is marked for its test database, closed to connections and owned by the owner role', async () => {
    if (!target.ok) throw new Error(target.reason);
    const key = templateKey(await schemaBuild());
    const name = templateName(target.database, key);
    const db = await freshDb();
    await db.close();
    const maintenance = connect(target.maintenanceUrl, { max: 1 });
    try {
      const [row] = await maintenance.sql<{ allow: boolean; owner: string; comment: string | null }[]>`
        select d.datallowconn as allow, pg_get_userbyid(d.datdba) as owner,
          shobj_description(d.oid, 'pg_database') as comment
        from pg_database d where d.datname = ${name}`;
      expect(row?.allow).toBe(false);
      expect(row?.owner).toBe(new URL(OWNER_URL).username);
      expect(parseTemplateComment(row?.comment)).toMatchObject({ database: target.database, key });
    } finally {
      await maintenance.close();
    }
  });

  it('AC-4 the age-out and cleanup listings never offer foreign databases that share the prefix', async () => {
    if (!target.ok) throw new Error(target.reason);
    const current = await ensureTemplate();
    const maintenance = connect(target.maintenanceUrl, { max: 1 });
    try {
      const unmarked = `${target.database}_tpl_${'0'.repeat(16)}`;
      const foreign = `${target.database}_tpl_${'f'.repeat(16)}`;
      for (const decoy of [unmarked, foreign]) {
        await maintenance.sql.unsafe(`DROP DATABASE IF EXISTS "${decoy}"`);
        await maintenance.sql.unsafe(`CREATE DATABASE "${decoy}"`);
        decoys.push(decoy);
      }
      await maintenance.sql.unsafe(
        `COMMENT ON DATABASE "${foreign}" IS 'daifuku-test-template v1 db=someone_else_test key=${'f'.repeat(64)} used=2026-10-29T00:00:00.000Z'`,
      );
      const rows = await listTemplates(maintenance, target.database);
      expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining([unmarked, foreign]));
      const own = rows.filter((row) => isOwnTemplate(target.database, row.name, row.comment)).map((row) => row.name);
      expect(own).not.toContain(unmarked);
      expect(own).not.toContain(foreign);
      expect(templatesToDrop(target.database, rows, 1, '')).toEqual(expect.not.arrayContaining([unmarked, foreign]));
      // pnpm test:db:templates lists (and with --drop drops) exactly the own templates.
      const listed = (await ownTemplates(target)).map((template) => template.name);
      expect(listed).toContain(current.name);
      expect(listed).not.toContain(unmarked);
      expect(listed).not.toContain(foreign);
    } finally {
      await maintenance.close();
    }
  });

  it('AC-4 a role without CREATEDB is refused before anything is dropped', async () => {
    if (!target.ok) throw new Error(target.reason);
    const asApp = new URL(target.maintenanceUrl);
    const appUrl = new URL(APP_URL);
    asApp.username = appUrl.username;
    asApp.password = appUrl.password;
    const maintenance = connect(asApp.href, { max: 1 });
    try {
      const state = await readTargetState(maintenance, target.database);
      expect(state.createdb).toBe(false);
      expect(targetProblem(state)).toMatch(/lacks CREATEDB/);
    } finally {
      await maintenance.close();
    }
  });

  it('AC-6 waits for sessions of this harness left on the test database, then rebuilds in place without dropping it', async () => {
    await ensureTemplate();
    const before = await oidOf(ready().database);
    const held = connect(OWNER_URL, { max: 1 });
    await held.sql`select 1`;
    try {
      const started = Date.now();
      const prepared = await prepareFromTemplate(ready(), OWNER_URL, { sessionWaitMs: 300 });
      expect(prepared).toEqual({
        owner: null,
        outcome: { used: 'legacy', reason: `sessions of this harness still use ${ready().database} after 300 ms` },
      });
      expect(Date.now() - started).toBeGreaterThanOrEqual(300);
      expect(await oidOf(ready().database)).toBe(before);
    } finally {
      await held.close();
    }
    await withFreshDb(async () => expect(schemaPreparation()).toMatchObject({ used: 'clone' }));
  });

  it('AC-6 gives up at once, without dropping anything, when a client other than this harness is connected', async () => {
    await ensureTemplate();
    const before = await oidOf(ready().database);
    const foreign = postgres(OWNER_URL, {
      max: 1,
      connection: { application_name: 'tpl-probe-psql' },
      onnotice: () => undefined,
    });
    await foreign`select 1`;
    try {
      const started = Date.now();
      const prepared = await prepareFromTemplate(ready(), OWNER_URL, { sessionWaitMs: 20_000 });
      expect(prepared).toEqual({
        owner: null,
        outcome: {
          used: 'legacy',
          reason: `another client is connected to ${ready().database} (application_name "tpl-probe-psql")`,
        },
      });
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(await oidOf(ready().database)).toBe(before);
    } finally {
      await foreign.end({ timeout: 5 });
    }
  });

  it('AC-6 leaves a template that a session is connected to (SQLSTATE 55006) and rebuilds in place', async () => {
    const { key, name } = await ensureTemplate();
    // Replace this key's template with an unmarked database of the same name, as an interrupted build leaves it.
    await withMaintenance(async (maintenance) => {
      await maintenance.sql.unsafe(`DROP DATABASE "${name}"`);
      await maintenance.sql.unsafe(`CREATE DATABASE "${name}"`);
    });
    const held = connect(databaseUrl(OWNER_URL, name), { max: 1 });
    await held.sql`select 1`;
    try {
      const prepared = await prepareFromTemplate(ready(), OWNER_URL, { sessionWaitMs: 300 });
      expect(prepared).toEqual({ owner: null, outcome: { used: 'legacy', reason: `${name} is in use` } });
      expect(await oidOf(name)).not.toBeNull();
    } finally {
      await held.close();
    }
    // Once the session is gone the unmarked database is replaced by a marked template built from template1.
    const rebuilt = await prepareFromTemplate(ready(), OWNER_URL);
    expect(rebuilt.outcome).toEqual({ used: 'built', template: name, key, base: 'template1' });
    await rebuilt.owner?.close();
  }, 60_000);

  it('AC-7 restores a test database that an interrupted run left missing from its own template', async () => {
    const { key, name } = await ensureTemplate();
    await withMaintenance((maintenance) => maintenance.sql.unsafe(`DROP DATABASE "${ready().database}"`));
    expect(await oidOf(ready().database)).toBeNull();
    await withFreshDb(async (restored) => {
      expect(schemaPreparation()).toEqual({ used: 'clone', template: name, key });
      expect(await restored.run({}, async (ctx) => ctx.companyId)).toBe(restored.companyId);
    });
  });

  it('AC-7 reports a missing test database that has no own template and creates nothing', async () => {
    const absent = `${ready().database}_absent`;
    const prepared = await prepareFromTemplate({ ...ready(), database: absent }, databaseUrl(OWNER_URL, absent));
    expect(prepared).toEqual({
      owner: null,
      outcome: { used: 'legacy', reason: `the test database ${absent} does not exist` },
    });
    expect(await oidOf(absent)).toBeNull();
  });

  it('AC-7 fails with the test database and the TEST_DATABASE_TEMPLATE=off advice and leaves no half-built template', async () => {
    await ensureTemplate();
    const bad = {
      reset: [...RESET_STATEMENTS],
      ddl: ['CREATE TABLE tpl_probe_bad (id int DEFAULT tpl_probe_no_such_function())'],
      policies: [],
    };
    const name = templateName(ready().database, templateKey(bad));
    const before = await oidOf(ready().database);
    await expect(prepareFromTemplate(ready(), OWNER_URL, { build: bad })).rejects.toThrow(
      new RegExp(
        `^Schema template for ${ready().database} failed: .*tpl_probe_no_such_function.*Set TEST_DATABASE_TEMPLATE=off`,
        's',
      ),
    );
    expect(await oidOf(name)).toBeNull();
    expect(await oidOf(ready().database)).toBe(before);
  });
});
