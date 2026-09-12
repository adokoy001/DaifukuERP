// docs/specs/phase15-cleanup.md AC-3 on Postgres: the rows a filter or a row rule actually returns for `$in: []`, `$ne: null`
// and `$in` with a null element (the SQL text is pinned in permissions.test.ts). Before the fix the empty `$in` returned
// every row whose column is set and `$ne: null` returned nothing. Test DB: TEST_DATABASE_URL* (daifuku_test by default).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineEntity } from '../src/dsl/entity.ts';
import { f } from '../src/dsl/fields.ts';
import type { Domain } from '../src/dsl/types.ts';
import { label } from '../src/i18n.ts';
import { newId } from '../src/ids.ts';
import { repo } from '../src/repository/repository.ts';
import { freshDb, type TestDb } from '../src/testing.ts';

const PermItem = defineEntity({
  name: 'perm_db_item',
  label: label('権限 DB テスト', 'Permission DB item'),
  fields: { name: f.text({ required: true }), ownerId: f.uuid(), region: f.text() },
  permissions: {
    roles: { none_rule: ['read'], not_null_rule: ['read'], region_rule: ['read'] },
    rowRules: [
      { roles: ['none_rule'], where: { region: { $in: [] } } },
      { roles: ['not_null_rule'], where: { ownerId: { $ne: null } } },
      { roles: ['region_rule'], where: { region: { $in: ['east', null] } } },
    ],
  },
});

let db: TestDb;

/** Names visible to `roles` for `where`, sorted; count() goes through the same filter. */
async function visible(roles: string[], where: Domain = {}): Promise<{ names: string[]; count: number }> {
  return db.run({ roles, actor: { type: 'user', id: newId() } }, async (ctx) => {
    const r = repo(ctx, PermItem);
    const names = (await r.list({ where, limit: 100 })).items.map((i) => i.name).sort();
    return { names, count: await r.count(where) };
  });
}

beforeAll(async () => {
  db = await freshDb();
  await db.run({}, async (ctx) => {
    const r = repo(ctx, PermItem);
    await r.create({ name: 'A', ownerId: newId(), region: 'east' });
    await r.create({ name: 'B' });
    await r.create({ name: 'C', ownerId: newId(), region: 'west' });
  });
});
afterAll(async () => {
  await db.close();
});

describe('domain operators on Postgres (phase15-cleanup AC-3)', () => {
  it('where: $in [] -> no row; $ne null -> the rows where the column is set; $in [value, null] -> the value and the unset rows', async () => {
    expect(await visible(['admin'])).toEqual({ names: ['A', 'B', 'C'], count: 3 });
    expect(await visible(['admin'], { region: { $in: [] } })).toEqual({ names: [], count: 0 }); // was A, C
    expect(await visible(['admin'], { ownerId: { $ne: null } })).toEqual({ names: ['A', 'C'], count: 2 }); // was none
    expect(await visible(['admin'], { region: { $in: ['east', null] } })).toEqual({ names: ['A', 'B'], count: 2 }); // was A
    expect(await visible(['admin'], { region: { $in: [null] } })).toEqual({ names: ['B'], count: 1 }); // was none
    expect(await visible(['admin'], { region: { $in: ['east', 'west'] } })).toEqual({ names: ['A', 'C'], count: 2 }); // unchanged
  });

  it('row rules: `$in: []` hides every row (was: exposed A, C); `$ne: null` shows A, C (was: none); `$in: [east, null]` shows A, B (was: A)', async () => {
    expect(await visible(['none_rule'])).toEqual({ names: [], count: 0 });
    expect(await visible(['not_null_rule'])).toEqual({ names: ['A', 'C'], count: 2 });
    expect(await visible(['region_rule'])).toEqual({ names: ['A', 'B'], count: 2 });
    // rules of several restricted roles are OR-ed
    expect(await visible(['none_rule', 'region_rule'])).toEqual({ names: ['A', 'B'], count: 2 });
    // a caller's own filter narrows inside the rule, never widens it
    expect(await visible(['region_rule'], { region: { $in: ['west', null] } })).toEqual({ names: ['B'], count: 1 });
  });
});
