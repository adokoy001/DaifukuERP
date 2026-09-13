// docs/specs/pack.md AC-3 against Postgres (kernel fixtures, no real modules): applyPack validates setting defaults before
// writing, is admin-only, needs a company, and runs inside the caller's transaction (a failing seed rolls back settings).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerPackActions } from '../src/actions/pack.ts';
import { runAction } from '../src/actions/run.ts';
import { newId } from '../src/ids.ts';
import { definePack } from '../src/dsl/pack.ts';
import { DaifukuError, NotFound, PermissionDenied, ValidationError } from '../src/errors.ts';
import { label } from '../src/i18n.ts';
import { applyPack, PACKS_APPLIED_KEY, readAppliedPacks } from '../src/pack.ts';
import { registry } from '../src/registry.ts';
import { repo } from '../src/repository/repository.ts';
import { getSetting } from '../src/settings.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { TPartner } from './fixtures/entities.ts';

let db: TestDb;
const GREETING = 'test_pack.greeting';
const LIMIT = 'test_pack.limit';

registry.registerSetting({ key: GREETING, label: label('挨拶', 'Greeting'), schema: z.string().min(1) });
registry.registerSetting({ key: LIMIT, label: label('上限', 'Limit'), schema: z.number().int().positive() });

definePack({
  name: 'dbpack_unknown',
  label: label('未登録設定', 'Unknown setting'),
  depends: ['test'],
  settings: { [GREETING]: 'hi', 'nope.missing': 1 },
  seed: seedPartner('Unknown seed'),
});
definePack({
  name: 'dbpack_invalid',
  label: label('不正値', 'Invalid value'),
  depends: ['test'],
  settings: { [LIMIT]: -3 },
});
definePack({
  name: 'dbpack_boom',
  label: label('seed 失敗', 'Seed fails'),
  depends: ['test'],
  settings: { [GREETING]: 'from boom' },
  seed: async (ctx) => {
    await repo(ctx, TPartner).create({ name: 'Boom partial' });
    throw new DaifukuError('INTERNAL', 'seed exploded', 'test');
  },
});
definePack({
  name: 'dbpack_ok',
  label: label('正常', 'OK'),
  version: '2.0.0',
  depends: ['test'],
  settings: { [GREETING]: 'hello', [LIMIT]: 5 },
  seed: seedPartner('OK seed'),
});

function seedPartner(name: string) {
  return async (ctx: Parameters<typeof repo>[0]) => {
    const r = repo(ctx, TPartner);
    if ((await r.count({ name })) === 0) await r.create({ name });
  };
}
const count = (name: string) => db.run({}, (ctx) => repo(ctx, TPartner).count({ name }));
async function storedSettings(): Promise<Record<string, unknown>> {
  const rows = await db.owner.sql`select settings from companies where id = ${db.companyId}`;
  return (rows[0]?.settings ?? {}) as Record<string, unknown>;
}

beforeAll(async () => {
  db = await freshDb();
  registerPackActions();
});
afterAll(async () => {
  await db.close();
});

describe('applyPack (AC-3)', () => {
  it('AC-3 unknown setting key -> ValidationError at apply (settings.<key>); nothing written, seed not run', async () => {
    const e = await db.run({}, (ctx) => applyPack(ctx, 'dbpack_unknown')).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ValidationError);
    expect((e as ValidationError).details).toEqual({
      issues: [{ path: 'settings.nope.missing', message: 'not a registered setting' }],
    });
    expect(await storedSettings()).toEqual({});
    expect(await count('Unknown seed')).toBe(0);
  });

  it('AC-3 a default that fails its setting schema -> ValidationError with the schema path', async () => {
    await expect(db.run({}, (ctx) => applyPack(ctx, 'dbpack_invalid'))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: `settings.${LIMIT}` }] },
    });
    expect(await storedSettings()).toEqual({});
  });

  it('AC-3 runs in the caller transaction: a failing seed rolls back the settings it wrote and packs.applied', async () => {
    await expect(db.run({}, (ctx) => applyPack(ctx, 'dbpack_boom'))).rejects.toThrow('seed exploded');
    expect(await storedSettings()).toEqual({});
    expect(await count('Boom partial')).toBe(0);
  });

  it('AC-3 permission: admin only (PermissionDenied for other roles); unknown pack -> NOT_FOUND listing known packs; no company -> NotFound', async () => {
    const clerk = { roles: ['manager'], actor: { type: 'user' as const, id: newId() } };
    await expect(db.run(clerk, (ctx) => applyPack(ctx, 'dbpack_ok'))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(db.run(clerk, (ctx) => runAction(ctx, 'pack.apply', { name: 'dbpack_ok' }))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    const missing = await db.run({}, (ctx) => applyPack(ctx, 'dbpack_nope')).catch((err: unknown) => err);
    expect(missing).toMatchObject({ code: 'NOT_FOUND', details: { pack: 'dbpack_nope' } });
    expect((missing as DaifukuError).hint).toContain('dbpack_ok');
    await expect(db.run({ companyId: null }, (ctx) => applyPack(ctx, 'dbpack_ok'))).rejects.toBeInstanceOf(NotFound);
    expect(await storedSettings()).toEqual({});
  });

  it('AC-3 success: every default written, seed run, packs.applied keeps other entries; sample flag without a sample is ignored', async () => {
    const other = { dbpack_legacy: { at: '2026-01-01T00:00:00.000Z', version: '9.9.9' } };
    await db.owner
      .sql`update companies set settings = ${JSON.stringify({ [PACKS_APPLIED_KEY]: other })}::jsonb where id = ${db.companyId}`;
    const now = new Date('2026-09-11T09:00:00.000Z');
    const res = await db.run({ now: () => now }, (ctx) =>
      runAction(ctx, 'pack.apply', { name: 'dbpack_ok', sample: true }),
    );
    expect(res).toEqual({
      name: 'dbpack_ok',
      version: '2.0.0',
      alreadyApplied: false,
      settings: { written: [GREETING, LIMIT], kept: [] },
      seeded: true,
      sampled: false,
      record: { at: now.toISOString(), version: '2.0.0' },
    });
    expect(await db.run({}, (ctx) => getSetting(ctx, GREETING, z.string(), ''))).toBe('hello');
    expect(await count('OK seed')).toBe(1);
    expect(await db.run({}, (ctx) => readAppliedPacks(ctx))).toEqual({
      ...other,
      dbpack_ok: { at: now.toISOString(), version: '2.0.0' },
    });
    const listed = (await db.run({ roles: ['viewer'], actor: { type: 'user' as const, id: newId() } }, (ctx) =>
      runAction(ctx, 'pack.list', {}),
    )) as { items: { name: string; applied: boolean }[] };
    expect(listed.items.map((i) => [i.name, i.applied])).toEqual([
      ['dbpack_unknown', false],
      ['dbpack_invalid', false],
      ['dbpack_boom', false],
      ['dbpack_ok', true],
    ]);
  });
});
