// db-test-startup (docs/specs/db-test-startup.md): the pure rules of the schema-template harness — which databases
// it may touch, how a template is keyed and named, which templates are its own, which ones age out, and that the key
// covers exactly the statements dropAll/enforcePolicies execute. The DB-level behaviour is in test-template.db.test.ts.
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client.ts';
import { RESET_STATEMENTS, dropAll, enforcePolicies, policyStatements } from '../src/db/migrate.ts';
import {
  DEFAULT_TEMPLATE_LIMIT,
  MAX_SHARD_INDEX,
  SHARD_BASE_NAME,
  SHARD_INFIX,
  isOwnTemplate,
  isShardDatabase,
  isShardTemplate,
  shardDatabaseName,
  parseTemplateComment,
  targetProblem,
  templateComment,
  templateKey,
  templateName,
  templateTarget,
  templatesToDrop,
  type TargetState,
} from '../src/test-database.ts';
import './fixtures/entities.ts';

const owner = (db: string, host = '127.0.0.1:5432') => `postgres://daifuku_owner:owner@${host}/${db}`;
const app = (db: string, host = '127.0.0.1:5432') => `postgres://daifuku_app:app@${host}/${db}`;
const KEY = 'ab'.repeat(32);
const OTHER_KEY = 'cd'.repeat(32);

describe('db-test-startup AC-4 template target (which database the harness may recreate)', () => {
  it('AC-4 accepts one plain lower-case database with a "test" segment for both roles and derives the maintenance URL', () => {
    expect(templateTarget(owner('daifuku_test_w1'), app('daifuku_test_w1'), {})).toEqual({
      ok: true,
      database: 'daifuku_test_w1',
      maintenanceUrl: owner('postgres'),
      limit: DEFAULT_TEMPLATE_LIMIT,
    });
    for (const name of ['daifuku_ci_test', 'daifuku_test', 'test', 'test_daifuku', 'daifuku_e2e_test_x'])
      expect(templateTarget(owner(name), app(name), {}), name).toMatchObject({ ok: true });
    expect(
      templateTarget(owner('daifuku_test'), app('daifuku_test'), {
        TEST_DATABASE_TEMPLATE_LIMIT: '3',
        TEST_DATABASE_MAINTENANCE_DB: 'template1',
      }),
    ).toMatchObject({ ok: true, limit: 3, maintenanceUrl: owner('template1') });
  });
  it.each([
    ['different databases', owner('daifuku_test_a'), app('daifuku_test_b'), /different databases/],
    [
      'different servers',
      owner('daifuku_test', '127.0.0.1:5432'),
      app('daifuku_test', '127.0.0.1:5433'),
      /different servers/,
    ],
    ['a name without "test"', owner('daifuku_dev'), app('daifuku_dev'), /does not look disposable/],
    ['a production-like name', owner('erp'), app('erp'), /does not look disposable/],
    // "test" inside another word is not a test segment: these may be anything.
    ['"test" inside a word (latest)', owner('daifuku_latest'), app('daifuku_latest'), /lacks a "test" segment/],
    ['"test" inside a word (contest)', owner('contest_prod'), app('contest_prod'), /lacks a "test" segment/],
    ['"test" inside a word (attestation)', owner('attestation'), app('attestation'), /lacks a "test" segment/],
    ['"tests" as a segment', owner('daifuku_tests'), app('daifuku_tests'), /lacks a "test" segment/],
    ['a quoted or upper-case name', owner('Daifuku_Test'), app('Daifuku_Test'), /plain lower-case identifier/],
    ['a name with a hyphen', owner('daifuku-test'), app('daifuku-test'), /plain lower-case identifier/],
    [
      'a name too long for templates',
      owner(`daifuku_test_${'x'.repeat(40)}`),
      app(`daifuku_test_${'x'.repeat(40)}`),
      /too long/,
    ],
    ['query parameters', `${owner('daifuku_test')}?options=x`, app('daifuku_test'), /query parameters/],
    ['a non-postgres URL', 'mysql://u:p@127.0.0.1/daifuku_test', app('daifuku_test'), /postgres/],
    ['an unparsable URL', 'not a url', app('daifuku_test'), /not URLs/],
  ])('AC-4 refuses %s and leaves the in-place rebuild in charge', (_label, ownerUrl, appUrl, reason) => {
    const target = templateTarget(ownerUrl, appUrl, {});
    expect(target.ok).toBe(false);
    if (!target.ok) expect(target.reason).toMatch(reason);
  });
  it('AC-4 refuses a maintenance database equal to the test database and invalid limits', () => {
    expect(
      templateTarget(owner('daifuku_test'), app('daifuku_test'), { TEST_DATABASE_MAINTENANCE_DB: 'daifuku_test' }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/maintenance database/) });
    for (const limit of ['0', '-1', '1.5', 'many'])
      expect(
        templateTarget(owner('daifuku_test'), app('daifuku_test'), { TEST_DATABASE_TEMPLATE_LIMIT: limit }),
      ).toMatchObject({ ok: false, reason: expect.stringMatching(/TEST_DATABASE_TEMPLATE_LIMIT/) });
  });
  it('AC-5 TEST_DATABASE_TEMPLATE=off|0|false|no disables templates; unknown values are refused, auto|on|1 enable', () => {
    for (const value of ['off', '0', 'false', 'no', 'OFF'])
      expect(templateTarget(owner('daifuku_test'), app('daifuku_test'), { TEST_DATABASE_TEMPLATE: value })).toEqual({
        ok: false,
        disabled: true,
        reason: 'disabled by TEST_DATABASE_TEMPLATE',
      });
    expect(
      templateTarget(owner('daifuku_test'), app('daifuku_test'), { TEST_DATABASE_TEMPLATE: 'maybe' }),
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/not one of auto, on or off/),
    });
    for (const value of ['auto', 'on', '1', 'true', 'yes', ''])
      expect(templateTarget(owner('daifuku_test'), app('daifuku_test'), { TEST_DATABASE_TEMPLATE: value }).ok).toBe(
        true,
      );
    // The cleanup command (pnpm test:db:templates) ignores the mode but keeps every other rule.
    const off = { TEST_DATABASE_TEMPLATE: 'off' };
    expect(templateTarget(owner('daifuku_test'), app('daifuku_test'), off, { ignoreMode: true }).ok).toBe(true);
    expect(templateTarget(owner('daifuku_dev'), app('daifuku_dev'), off, { ignoreMode: true }).ok).toBe(false);
  });
});

describe('db-test-startup AC-4 database-level preconditions', () => {
  const ready: TargetState = {
    createdb: true,
    exists: true,
    owned: true,
    defaultAcl: true,
    settings: 0,
    commented: false,
    template: false,
    allowConnections: true,
    connectionLimit: -1,
    defaultTablespace: true,
    sameLocaleAsTemplate1: true,
  };
  it('AC-4 recreates only a database it owns whose database-level attributes a recreation would keep', () => {
    expect(targetProblem(ready)).toBeNull();
    expect(targetProblem({ ...ready, exists: false })).toBeNull();
    expect(targetProblem({ ...ready, createdb: false })).toMatch(/lacks CREATEDB/);
    expect(targetProblem({ ...ready, owned: false })).toMatch(/does not own/);
    expect(targetProblem({ ...ready, defaultAcl: false })).toMatch(/database-level grants/);
    expect(targetProblem({ ...ready, settings: 1 })).toMatch(/ALTER DATABASE\/ROLE settings/);
    expect(targetProblem({ ...ready, commented: true })).toMatch(/comment that recreation would drop/);
    expect(targetProblem({ ...ready, template: true })).toMatch(/template or closed/);
    expect(targetProblem({ ...ready, allowConnections: false })).toMatch(/template or closed/);
    expect(targetProblem({ ...ready, connectionLimit: 5 })).toMatch(/connection limit/);
    expect(targetProblem({ ...ready, defaultTablespace: false })).toMatch(/default tablespace/);
    // Another locale only changes where a new template is built (in place instead of a copy of template1).
    expect(targetProblem({ ...ready, sameLocaleAsTemplate1: false })).toBeNull();
  });
});

describe('db-test-startup AC-1 AC-2 keys, names and markers', () => {
  const build = { reset: ['r1'], ddl: ['create table a ()', 'create table b ()'], policies: ['grant x'] };
  it('AC-1 keys a template by every statement of the build and changes the key when any statement changes', () => {
    const key = templateKey(build);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(templateKey({ ...build })).toBe(key);
    expect(templateKey({ ...build, reset: ['r2'] })).not.toBe(key);
    expect(templateKey({ ...build, ddl: ['create table b ()', 'create table a ()'] })).not.toBe(key);
    expect(templateKey({ ...build, policies: ['grant y'] })).not.toBe(key);
    expect(templateKey({ reset: [], ddl: ['r1', ...build.ddl], policies: build.policies })).not.toBe(key);
  });
  it('AC-2 names templates <db>_tpl_<16 hex> within the PostgreSQL identifier limit and marks them', () => {
    const name = templateName('daifuku_test_w1', KEY);
    expect(name).toBe(`daifuku_test_w1_tpl_${KEY.slice(0, 16)}`);
    expect(templateName(`daifuku_test_${'x'.repeat(29)}`, KEY).length).toBeLessThanOrEqual(63);
    const used = new Date('2026-10-29T10:00:00.000Z');
    const comment = templateComment('daifuku_test_w1', KEY, used);
    expect(parseTemplateComment(comment)).toEqual({ format: 1, database: 'daifuku_test_w1', key: KEY, usedAt: used });
    expect(isOwnTemplate('daifuku_test_w1', name, comment)).toBe(true);
  });
  it('AC-4 never treats a foreign, unmarked or mismatched database as its own template', () => {
    const name = templateName('daifuku_test_w1', KEY);
    const comment = templateComment('daifuku_test_w1', KEY, new Date());
    expect(isOwnTemplate('daifuku_test_w1', name, null)).toBe(false);
    expect(isOwnTemplate('daifuku_test_w1', name, 'a comment someone wrote')).toBe(false);
    expect(isOwnTemplate('daifuku_test_w1', name, templateComment('daifuku_test_w2', KEY, new Date()))).toBe(false);
    expect(isOwnTemplate('daifuku_test_w1', name, templateComment('daifuku_test_w1', OTHER_KEY, new Date()))).toBe(
      false,
    );
    // Same marker, but the name belongs to another test database's prefix or is not exactly <db>_tpl_<16 hex>.
    expect(isOwnTemplate('daifuku_test_w1', `daifuku_test_w10_tpl_${KEY.slice(0, 16)}`, comment)).toBe(false);
    expect(isOwnTemplate('daifuku_test', `daifuku_test_tpl_tpl_${KEY.slice(0, 16)}`, comment)).toBe(false);
    expect(isOwnTemplate('daifuku_test_w1', `${name}x`, comment)).toBe(false);
    expect(parseTemplateComment(`${comment} extra`)).toBeNull();
    expect(parseTemplateComment(comment.replace(/used=\S+/, 'used=yesterday'))).toBeNull();
  });
  it('AC-2 ages out its own templates beyond the limit, least recently used first, and never foreign ones', () => {
    const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`);
    const key = (n: number) =>
      `${n}`
        .repeat(64)
        .slice(0, 64)
        .replace(/[^0-9a-f]/g, 'a');
    const own = [1, 2, 3, 4].map((n) => ({
      name: templateName('daifuku_test_w1', key(n)),
      comment: templateComment('daifuku_test_w1', key(n), at(n)),
    }));
    const foreign = [
      { name: `daifuku_test_w1_tpl_${'0'.repeat(16)}`, comment: null },
      { name: templateName('daifuku_test_w1', key(5)), comment: templateComment('daifuku_test_w2', key(5), at(1)) },
      { name: templateName('daifuku_test_w10', key(6)), comment: templateComment('daifuku_test_w10', key(6), at(1)) },
    ];
    const rows = [...foreign, ...own];
    // keep = the template just created (newest); limit 3 keeps it plus the two most recently used others.
    expect(templatesToDrop('daifuku_test_w1', rows, 3, own[0]?.name ?? '')).toEqual([own[1]?.name]);
    expect(templatesToDrop('daifuku_test_w1', rows, 1, own[0]?.name ?? '').sort()).toEqual(
      [own[1]?.name, own[2]?.name, own[3]?.name].sort(),
    );
    expect(templatesToDrop('daifuku_test_w1', rows, DEFAULT_TEMPLATE_LIMIT, own[0]?.name ?? '')).toEqual([]);
  });
});

describe('light-tier-speed AC-7 shard databases of the light tier (docs/specs/light-tier-speed.md)', () => {
  it('AC-7 recognises only what the tier runner creates: <db>_shard_2..8 of a daifuku_test[_suffix] database', () => {
    expect(SHARD_INFIX).toBe('_shard_');
    expect(MAX_SHARD_INDEX).toBe(8);
    expect(shardDatabaseName('daifuku_test_w9', 1)).toBe('daifuku_test_w9');
    expect(shardDatabaseName('daifuku_test_w9', 3)).toBe('daifuku_test_w9_shard_3');
    for (let index = 2; index <= MAX_SHARD_INDEX; index++)
      expect(isShardDatabase('daifuku_test_w9', shardDatabaseName('daifuku_test_w9', index)), String(index)).toBe(true);
    expect(isShardDatabase('daifuku_test', 'daifuku_test_shard_2')).toBe(true);
    expect(isShardDatabase('daifuku_ci_test', 'daifuku_ci_test_shard_8')).toBe(true);
    for (const name of [
      'daifuku_test_w9',
      'daifuku_test_w9_shard_1',
      'daifuku_test_w9_shard_9',
      'daifuku_test_w9_shard_12',
      'daifuku_test_w9_shard_42',
      'daifuku_test_w9_shard_97',
      'daifuku_test_w9_shard_02',
      'daifuku_test_w9_shard_',
      'daifuku_test_w9_shard_2x',
      'daifuku_test_w9_shard_2_tpl_0123456789abcdef',
      'daifuku_test_w91_shard_2',
      'daifuku_test_shard_2',
      'daifuku_test_w9_tpl_0123456789abcdef',
    ])
      expect(isShardDatabase('daifuku_test_w9', name), name).toBe(false);
    // A base the tier runner never shards (another disposable name, or a shard database itself).
    expect(SHARD_BASE_NAME.test('scratch_test')).toBe(false);
    expect(isShardDatabase('scratch_test', 'scratch_test_shard_2')).toBe(false);
    expect(isShardDatabase('daifuku_test_w9_shard_2', 'daifuku_test_w9_shard_2_shard_2')).toBe(false);
  });
  it('AC-7 finds a shard template by its name and marker, whether or not its shard database still exists', () => {
    const shard = shardDatabaseName('daifuku_test_w9', 3);
    const name = templateName(shard, KEY);
    expect(isShardTemplate('daifuku_test_w9', name, templateComment(shard, KEY, new Date(0)))).toBe(true);
    // Unmarked, marked for another database, a shard outside 2..8, or a template of the test database itself.
    expect(isShardTemplate('daifuku_test_w9', name, null)).toBe(false);
    expect(isShardTemplate('daifuku_test_w9', name, templateComment('daifuku_test_w9', KEY, new Date(0)))).toBe(false);
    const far = shardDatabaseName('daifuku_test_w9', 42);
    expect(isShardTemplate('daifuku_test_w9', templateName(far, KEY), templateComment(far, KEY, new Date(0)))).toBe(
      false,
    );
    expect(
      isShardTemplate(
        'daifuku_test_w9',
        templateName('daifuku_test_w9', KEY),
        templateComment('daifuku_test_w9', KEY, new Date(0)),
      ),
    ).toBe(false);
  });
  it('AC-7 gives a shard database room for its own schema templates', () => {
    const shard = shardDatabaseName('daifuku_test_w9', 8);
    expect(templateTarget(owner(shard), app(shard), {})).toMatchObject({ ok: true, database: shard });
    expect(templateName(shard, KEY).startsWith(`${shard}_tpl_`)).toBe(true);
    expect(isOwnTemplate('daifuku_test_w9', templateName(shard, KEY), templateComment(shard, KEY, new Date(0)))).toBe(
      false,
    );
  });
});

describe('db-test-startup AC-1 the key covers what the harness executes', () => {
  function recorder() {
    const executed: string[] = [];
    const fake = {
      drizzle: {
        execute: async (query: { queryChunks?: { value?: string[] }[] }) => {
          executed.push((query.queryChunks ?? []).flatMap((chunk) => chunk.value ?? []).join(''));
          return [];
        },
      },
    } as unknown as Database;
    return { executed, fake };
  }
  it('AC-1 dropAll executes RESET_STATEMENTS and enforcePolicies executes policyStatements(), in order', async () => {
    const reset = recorder();
    await dropAll(reset.fake);
    expect(reset.executed).toEqual([...RESET_STATEMENTS]);
    const policies = recorder();
    await enforcePolicies(policies.fake);
    expect(policies.executed).toEqual(policyStatements());
    expect(policyStatements()).toContain('ALTER TABLE "test_memo" FORCE ROW LEVEL SECURITY');
    expect(policyStatements()).toContain('GRANT SELECT, INSERT ON "audit_log" TO daifuku_app');
  });
});
