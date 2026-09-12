import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineEntity, f, label, registerCrudActions, repo, runAction, type Domain } from '../src/index.ts';
import type { DomainScalar } from '../src/dsl/types.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
const midnight = '2026-09-11T00:00:00+09:00';
const Event = defineEntity({ name: 'timestamp_query_event', label: label('日時検索検証', 'Timestamp query event'), fields: {
  name: f.text({ required: true }), position: f.int({ required: true }), at: f.timestamp(), date: f.date({ required: true }), text: f.text({ required: true }),
}, permissions: { roles: { timestamp_reader: ['read'], timestamp_before: ['read'] }, rowRules: [{ roles: ['timestamp_before'], where: { at: { $lt: midnight } } }] } });
registerCrudActions();
let db: TestDb;
beforeAll(async () => {
  db = await freshDb();
  let position = 0;
  for (const [name, at] of [['before', '2026-09-10T14:59:59.999Z'], ['exact', '2026-09-10T15:00:00.000Z'], ['after', '2026-09-10T15:00:00.001Z'], ['unset', null]] as const) {
    await db.run({ now: () => new Date(at ?? '2026-09-10T15:00:00.002Z') }, (ctx) => repo(ctx, Event).create({ name, position: position++, at: at ? new Date(at) : null, date: name === 'before' ? '2026-09-10' : '2026-09-11', text: midnight }));
  }
});
afterAll(async () => { await db?.close(); });
async function names(where: Domain, roles = ['timestamp_reader']): Promise<string[]> {
  // Generated CRUD actions use the same parsed JSON input contract as REST/MCP list requests.
  const input: unknown = JSON.parse(JSON.stringify({ where, orderBy: [{ field: 'name' }] }));
  const result = await db.run({ roles }, (ctx) => runAction(ctx, 'timestamp_query_event.list', input)) as { items: { name: string }[] };
  return result.items.map((row) => row.name);
}
describe('timestamp query operands use exact zoned instants before reaching the driver', () => {
  it.each(['2026-09-10T15:00:00Z', midnight, '2026-09-10T11:00:00-04:00', '2026-09-10T15:00:00.0Z'])('matches equivalent instant %s', async (value) => {
    expect(await names({ at: value })).toEqual(['exact']);
  });
  it('applies every range and not-equal operator with millisecond boundaries', async () => {
    for (const [op, expected] of [['$ne', ['after', 'before']], ['$gt', ['after']], ['$gte', ['after', 'exact']], ['$lt', ['before']], ['$lte', ['before', 'exact']]] as const) {
      expect(await names({ at: { [op]: midnight } })).toEqual(expected);
    }
    expect(await names({ $and: [{ at: { $gte: midnight } }, { at: { $lt: '2026-09-10T15:00:00.001Z' } }] })).toEqual(['exact']);
  });
  it('combines same-field timestamp, numeric, date and text operators conjunctively', async () => {
    expect(await names({ at: { $gte: midnight, $lt: '2026-09-10T15:00:00.001Z' } })).toEqual(['exact']);
    expect(await names({ position: { $gte: 1, $lt: 2 } })).toEqual(['exact']);
    expect(await names({ date: { $gte: '2026-09-10', $lt: '2026-09-11' } })).toEqual(['before']);
    expect(await names({ name: { $in: ['before', 'after'], $ne: 'before' } })).toEqual(['after']);
  });
  it('rejects unknown or malformed operators even beside a valid comparison', async () => {
    for (const at of [{ $gte: midnight, $unknown: midnight }, {}, { $gte: { value: midnight } }, { $in: [midnight, {}] }]) {
      await expect(names({ at } as Domain)).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    await expect(names({ name: { $like: 1 } } as unknown as Domain)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(names({ position: { $gte: 0, $unknown: 1 } } as Domain)).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('preserves null and empty-list semantics for timestamp membership filters', async () => {
    expect(await names({ at: { $in: [midnight, null] } })).toEqual(['exact', 'unset']);
    expect(await names({ at: { $in: [] } })).toEqual([]);
    expect(await names({ at: { $in: [null] } })).toEqual(['unset']);
    expect(await names({ at: { $ne: null } })).toEqual(['after', 'before', 'exact']);
    expect(await names({ at: null })).toEqual(['unset']);
  });
  it('uses column metadata for system timestamps, row permissions, count and aggregate', async () => {
    expect(await names({ createdAt: midnight })).toEqual(['exact']);
    expect(await names({ updatedAt: { $in: [midnight] } })).toEqual(['exact']);
    expect(await names({}, ['timestamp_before'])).toEqual(['before']);
    await db.run({ roles: ['timestamp_reader'] }, async (ctx) => {
      expect(await repo(ctx, Event).count({ at: { $gte: midnight } })).toBe(2);
      const result = await repo(ctx, Event).aggregate({ where: { at: { $gte: midnight } }, metrics: { count: { count: true } } });
      expect(result[0]?.count).toBe(2);
    });
  });
  it('keeps local-date and text fields unchanged', async () => {
    expect(await names({ date: '2026-09-11' })).toEqual(['after', 'exact', 'unset']);
    expect(await names({ date: { $lt: '2026-09-11' } })).toEqual(['before']);
    expect(await names({ text: midnight })).toEqual(['after', 'before', 'exact', 'unset']);
    expect(await names({ text: '2026-09-10T15:00:00Z' })).toEqual([]);
    expect(await names({ text: { $like: '2026-09-11%' } })).toHaveLength(4);
  });
  it('rejects malformed datetime operands with structured paths instead of driver errors', async () => {
    const invalid: DomainScalar[] = ['not a timestamp', '2026-02-30T00:00:00Z', '2026-09-11T00:00:00', '2026-09-11', '2026-09-11T24:00:00Z', '2026-09-11T00:00:00+99:00', '2026-09-11T00:00:00.0001Z', '', 0, true];
    for (const value of invalid) {
      await expect(names({ at: value })).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'where.at' }] } });
      await expect(names({ at: { $gte: value } })).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'where.at.$gte' }] } });
      await expect(names({ at: { $in: [midnight, value] } })).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'where.at.$in.1' }] } });
    }
    await expect(names({ at: { $like: '2026%' } })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(names({ at: { $in: 'not-an-array' } } as unknown as Domain)).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'where.at.$in' }] } });
  });
});
