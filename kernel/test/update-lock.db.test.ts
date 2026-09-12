// ADR-0020: ordinary updates must serialize writers without blocking FK key-share before business locks.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineEntity } from '../src/dsl/entity.ts';
import { f } from '../src/dsl/fields.ts';
import { safeErrorDiagnostics } from '../src/errors.ts';
import { label } from '../src/i18n.ts';
import { newId } from '../src/ids.ts';
import { registry } from '../src/registry.ts';
import { repo } from '../src/repository/repository.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { withLock } from '../src/transactions.ts';

const Parent = defineEntity({ name: 'test_update_lock_parent', label: label('親行', 'Parent'), fields: { name: f.text({ required: true }) }, permissions: { roles: {} } });
const Reference = defineEntity({ name: 'test_update_lock_ref', label: label('参照行', 'Reference'), fields: { parentId: f.ref(Parent.name, { required: true }) }, permissions: { roles: {} } });
let db: TestDb;
beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db.close(); });
function latch() {
  let release = () => undefined as void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function outcome(result: PromiseSettledResult<unknown>) {
  return result.status === 'fulfilled' ? { status: result.status } : { status: result.status, ...safeErrorDiagnostics(result.reason) };
}

describe('ordinary update row lock and reference integrity', () => {
  it('allows FK insertion while an update hook waits on the publisher business lock', async () => {
    const parent = await db.run({}, (ctx) => repo(ctx, Parent).create({ name: 'Before' }));
    const businessKey = `update-lock:${parent.id}`, held = latch(), entered = latch();
    registry.registerHook(Parent.name, 'before_update', async (ctx, { row }) => {
      if (row.id !== parent.id) return;
      entered.release();
      await withLock(ctx, businessKey, async () => undefined);
    });
    const inserting = db.run({}, async (ctx) => {
      await ctx.db.execute(sql`set local statement_timeout = '5s'`);
      return withLock(ctx, businessKey, async () => { held.release(); await entered.promise; return repo(ctx, Reference).create({ parentId: parent.id }); });
    });
    await held.promise;
    const updating = db.run({}, async (ctx) => {
      await ctx.db.execute(sql`set local statement_timeout = '5s'`);
      return repo(ctx, Parent).update(parent.id, { name: 'After' }, { expectedVersion: parent.version });
    });
    const results = await Promise.allSettled([inserting, updating]);
    expect(results.map(outcome)).toEqual([{ status: 'fulfilled' }, { status: 'fulfilled' }]);
    expect((await db.run({}, (ctx) => repo(ctx, Parent).get(parent.id)))).toMatchObject({ name: 'After', version: 2 });
    expect(await db.run({}, (ctx) => repo(ctx, Reference).count({ parentId: parent.id }))).toBe(1);
  });

  it('continues to serialize ordinary writers and reject the stale expected version', async () => {
    const parent = await db.run({}, (ctx) => repo(ctx, Parent).create({ name: 'Original' }));
    const results = await Promise.allSettled(['First', 'Second'].map((name) => db.run({}, (ctx) => repo(ctx, Parent).update(parent.id, { name }, { expectedVersion: parent.version }))));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } });
    expect((await db.run({}, (ctx) => repo(ctx, Parent).get(parent.id))).version).toBe(2);
  });

  it('keeps explicit Repository.lock exclusive against concurrent reference key-share', async () => {
    const parent = await db.run({}, (ctx) => repo(ctx, Parent).create({ name: 'Explicit lock' })), held = latch(), release = latch();
    const locking = db.run({}, async (ctx) => { await repo(ctx, Parent).lock(parent.id); held.release(); await release.promise; });
    await held.promise;
    try {
      const attempted = await db.run({}, (ctx) => ctx.db.execute(sql`select ${Parent.col('id')} from ${Parent.table} where ${Parent.col('id')} = ${parent.id} for key share nowait`)).then(() => null, (error: unknown) => safeErrorDiagnostics(error));
      expect(attempted).toEqual({ category: 'database', sqlState: '55P03' });
    } finally { release.release(); await locking; }
  });

  it('rejects id, tenant and company rewrites on the ordinary update path', async () => {
    const parent = await db.run({}, (ctx) => repo(ctx, Parent).create({ name: 'Stable identity' }));
    for (const field of ['id', 'tenantId', 'companyId']) await expect(db.run({}, (ctx) => repo(ctx, Parent).update(parent.id, { [field]: newId() }))).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await db.run({}, (ctx) => repo(ctx, Parent).get(parent.id))).toEqual(parent);
  });
});
