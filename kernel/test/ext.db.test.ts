// docs/specs/kernel-phase15.md A (AC-2, AC-4, AC-5) against Postgres: ext values validated on write, stored canonically in
// JSONB, filtered with `ext.<key>` (->>) and found by the generic search. Verification step 3 of the spec, on the fixture
// entity `test_partner` (the kernel tests have no `partner` module).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerCrudActions } from '../src/actions/crud.ts';
import { runAction } from '../src/actions/run.ts';
import { f } from '../src/dsl/fields.ts';
import { ValidationError } from '../src/errors.ts';
import { label } from '../src/i18n.ts';
import { entityMeta } from '../src/meta.ts';
import { registry } from '../src/registry.ts';
import { repo } from '../src/repository/repository.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { TPartner } from './fixtures/entities.ts';

let db: TestDb;
type Row = Record<string, unknown>;
const JAN = '4901234567894';

const issues = (e: unknown) =>
  ((e as ValidationError).details as { issues: { path: string; message: string }[] }).issues;
async function caught(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

beforeAll(async () => {
  db = await freshDb();
  registerCrudActions();
  // a pack would do this at import time; the schema needs no migration (ext is JSONB)
  registry.registerExt(
    TPartner.name,
    {
      jan: f.text({ label: label('JANコード', 'JAN code'), searchable: true, pattern: /^\d{8,13}$/ }),
      rank: f.enum(['a', 'b', 'c'], { label: label('ランク', 'Rank') }),
      creditLine: f.money({ label: label('与信枠', 'Credit line'), min: '0' }),
      firstOrder: f.date(),
      memo: f.text({ label: label('メモ', 'Memo') }), // not searchable
    },
    { source: 'pack_retail_test' },
  );
});
afterAll(async () => {
  await db.close();
});

describe('ext fields on the Repository (AC-2)', () => {
  it('AC-2 create with ext: registered keys validated and stored canonically (decimal strings), unknown keys kept', async () => {
    const created = await db.run({}, (ctx) =>
      repo(ctx, TPartner).create({
        name: 'Ext A',
        ext: {
          jan: JAN,
          rank: 'a',
          creditLine: '100000.50',
          firstOrder: '2026-09-11',
          legacyCode: { from: 'old-system', id: 42 },
        },
      }),
    );
    expect(created.ext).toEqual({
      jan: JAN,
      rank: 'a',
      creditLine: '100000.5',
      firstOrder: '2026-09-11',
      legacyCode: { from: 'old-system', id: 42 },
    });
    const raw = await db.owner.sql`select ext from test_partner where id = ${created.id}`;
    expect(raw[0]?.ext).toEqual({
      jan: JAN,
      rank: 'a',
      creditLine: '100000.5',
      firstOrder: '2026-09-11',
      legacyCode: { from: 'old-system', id: 42 },
    });
    expect(typeof (raw[0]?.ext as Row).creditLine).toBe('string');
  });

  it('AC-2 bad registered values -> VALIDATION with ext.<key> paths, nothing written; also through the generic action', async () => {
    const before = await db.run({}, (ctx) => repo(ctx, TPartner).count());
    const e = await caught(
      db.run({}, (ctx) =>
        repo(ctx, TPartner).create({
          name: 'Bad',
          ext: { jan: 'x49', rank: 'z', creditLine: 12.5, firstOrder: '2026-02-30' },
        }),
      ),
    );
    expect(e).toBeInstanceOf(ValidationError);
    expect(
      issues(e)
        .map((i) => i.path)
        .sort(),
    ).toEqual(['ext.creditLine', 'ext.firstOrder', 'ext.jan', 'ext.rank']);
    const viaAction = await caught(
      db.run({}, (ctx) => runAction(ctx, 'test_partner.create', { name: 'Bad2', ext: { creditLine: '-1' } })),
    );
    expect(viaAction).toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'ext.creditLine' }] } });
    expect(await db.run({}, (ctx) => repo(ctx, TPartner).count())).toBe(before);
  });

  it('AC-2 update: ext replaces the stored object and is validated; a patch without ext leaves it untouched', async () => {
    const p = await db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'Ext U', ext: { rank: 'b', other: 1 } }));
    const renamed = await db.run({}, (ctx) => repo(ctx, TPartner).update(p.id, { name: 'Ext U2' }));
    expect(renamed.ext).toEqual({ rank: 'b', other: 1 });
    await expect(db.run({}, (ctx) => repo(ctx, TPartner).update(p.id, { ext: { rank: 'q' } }))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'ext.rank' }] },
    });
    const changed = await db.run({}, (ctx) =>
      repo(ctx, TPartner).update(p.id, { ext: { rank: 'c', creditLine: '0.10' } }),
    );
    expect(changed.ext).toEqual({ rank: 'c', creditLine: '0.1' });
  });
});

describe('ext.<key> filters and search (AC-4, AC-5)', () => {
  let ids: Record<string, string>;

  beforeAll(async () => {
    const mk = (name: string, ext?: Row) =>
      db.run({}, (ctx) => repo(ctx, TPartner).create(ext ? { name, ext } : { name })).then((r) => r.id);
    ids = {
      b1: await mk('Filter B1', { jan: '4900000000011', rank: 'b', creditLine: '500', memo: 'needle-in-memo' }),
      b2: await mk('Filter B2', { jan: '4900000000028', rank: 'b', creditLine: '500.00' }),
      c: await mk('Filter C', { jan: '12345670', rank: 'c' }),
      none: await mk('Filter None'),
    };
  });

  const listIds = async (q: Parameters<ReturnType<typeof repo<typeof TPartner>>['list']>[0]) =>
    (await db.run({}, (ctx) => repo(ctx, TPartner).list({ ...q, orderBy: [{ field: 'name', dir: 'asc' }] }))).items.map(
      (r) => r.id,
    );

  it('AC-4 where ext.<key>: text equality, $in, $ne, null, $like on text; decimals compare in canonical form', async () => {
    expect(await listIds({ where: { 'ext.jan': '4900000000011' } })).toEqual([ids.b1]);
    expect(await listIds({ where: { 'ext.rank': 'b', name: { $like: 'Filter%' } } })).toEqual([ids.b1, ids.b2]);
    expect(await listIds({ where: { 'ext.rank': { $in: ['c', 'a'] }, name: { $like: 'Filter%' } } })).toEqual([ids.c]);
    expect(await listIds({ where: { 'ext.rank': { $ne: 'b' }, name: { $like: 'Filter%' } } })).toEqual([ids.c]);
    expect(await listIds({ where: { 'ext.jan': null, name: { $like: 'Filter%' } } })).toEqual([ids.none]);
    expect(await listIds({ where: { 'ext.jan': { $like: '4900%' } } })).toEqual([ids.b1, ids.b2]);
    // '500' and '500.00' were both stored as '500'; the filter value is canonicalised the same way
    expect(await listIds({ where: { 'ext.creditLine': '500.0' } })).toEqual([ids.b1, ids.b2]);
    // (the 'Ext U' partner of the update test also has rank c, hence the name filter)
    expect(
      await listIds({
        where: { $or: [{ 'ext.rank': 'c' }, { 'ext.jan': '4900000000028' }], name: { $like: 'Filter%' } },
      }),
    ).toEqual([ids.b2, ids.c]);
    expect(await listIds({ where: { 'ext.rank': { $in: [] } } })).toEqual([]);
    expect(await db.run({}, (ctx) => repo(ctx, TPartner).count({ 'ext.rank': 'b', name: { $like: 'Filter%' } }))).toBe(
      2,
    );
  });

  it('AC-4 the generic list action (REST/MCP path) accepts ext.<key> in where', async () => {
    const res = (await db.run({}, (ctx) =>
      runAction(ctx, 'test_partner.list', { where: { 'ext.jan': '12345670' } }),
    )) as { items: Row[]; total: number };
    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ id: ids.c, ext: { jan: '12345670', rank: 'c' } });
  });

  it('AC-4 unregistered ext keys and range operators -> VALIDATION with a hint', async () => {
    const unknown = await caught(listIds({ where: { 'ext.nope': 'x' } }));
    expect(unknown).toBeInstanceOf(ValidationError);
    expect((unknown as ValidationError).hint).toContain('ext.jan');
    expect(issues(unknown)).toEqual([{ path: 'where.ext.nope', message: 'ext key is not registered' }]);
    const range = await caught(listIds({ where: { 'ext.creditLine': { $gt: '100' } } }));
    expect(range).toBeInstanceOf(ValidationError);
    expect((range as ValidationError).hint).toContain('Range operators');
    expect(await caught(listIds({ where: { 'ext.rank': { $like: 'b%' } } }))).toBeInstanceOf(ValidationError); // $like: text kinds only
  });

  it('AC-5 search matches searchable text ext fields alongside views.search; non-searchable ext fields are not searched', async () => {
    expect(await listIds({ search: '00000000028' })).toEqual([ids.b2]);
    expect(await listIds({ search: 'Filter C' })).toEqual([ids.c]); // entity search field still works
    expect(await listIds({ search: 'needle-in-memo' })).toEqual([]);
    const viaAction = (await db.run({}, (ctx) => runAction(ctx, 'test_partner.list', { search: '4900000000011' }))) as {
      items: Row[];
    };
    expect(viaAction.items.map((r) => r.id)).toEqual([ids.b1]);
  });

  it('AC-3 entityMeta.extFields describes the registered keys for the generic form', async () => {
    const meta = await db.run({}, async (ctx) => entityMeta(ctx, TPartner, { currency: 'JPY' }));
    expect(meta.extFields.map((x) => [x.name, x.kind, x.required, x.searchable ?? false, x.source])).toEqual([
      ['ext.jan', 'text', false, true, 'pack_retail_test'],
      ['ext.rank', 'enum', false, false, 'pack_retail_test'],
      ['ext.creditLine', 'decimal', false, false, 'pack_retail_test'],
      ['ext.firstOrder', 'date', false, false, 'pack_retail_test'],
      ['ext.memo', 'text', false, false, 'pack_retail_test'],
    ]);
    expect(meta.extFields.find((x) => x.name === 'ext.creditLine')).toMatchObject({
      label: { ja: '与信枠', en: 'Credit line' },
      money: true,
      scale: 0,
    });
  });
});
