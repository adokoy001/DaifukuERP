import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { companies } from '../src/db/system-tables.ts';
import { definePack } from '../src/dsl/pack.ts';
import { f } from '../src/dsl/fields.ts';
import { label } from '../src/i18n.ts';
import { newId } from '../src/ids.ts';
import { entityMeta } from '../src/meta.ts';
import { applyPack } from '../src/pack.ts';
import { registry } from '../src/registry.ts';
import { repo } from '../src/repository/repository.ts';
import { getSetting, setSetting } from '../src/settings.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { TPartner } from './fixtures/entities.ts';
import { defineEntity } from '../src/dsl/entity.ts';
import { defineAction } from '../src/dsl/action.ts';
import { runAction } from '../src/actions/run.ts';

let db: TestDb;
let companyB: string;
const PackItem = defineEntity({ name: 'test_pack_item', label: label('専用', 'Pack item'), fields: { name: f.text({ required: true }) }, permissions: { roles: { viewer: ['read'] } } });
const packAction = defineAction({ name: 'scope_pack.check', description: label('確認', 'Check'), input: z.object({}), output: z.object({ ok: z.boolean() }), permission: 'authenticated', handler: async () => ({ ok: true }) });
registry.registerSetting({ key: 'scoped.mode', label: label('設定', 'Mode'), schema: z.string(), default: 'module-default' });
definePack({ name: 'scope_pack', label: label('会社別', 'Company scoped'), depends: ['test'],
  entities: [PackItem], actions: [packAction],
  ext: { test_partner: { requiredTag: f.text({ required: true }), defaultTag: f.text() } },
  labels: { test_partner: { entity: label('パック取引先', 'Pack partner') } },
  settings: { 'scoped.mode': 'pack-default' },
  hooks: () => registry.registerHook(TPartner.name, 'before_validate', (_ctx, { row }) => {
    if (row.name === 'blocked-by-pack') throw new Error('pack guard');
    row.ext = { ...(row.ext as Record<string, unknown> ?? {}), defaultTag: 'pack-default' };
  }),
  seed: async (ctx) => {
    await repo(ctx, TPartner).create({ name: 'scoped seed', ext: { requiredTag: 'seed' } });
  },
});
beforeAll(async () => {
  db = await freshDb();
  companyB = newId();
  await db.owner.drizzle.insert(companies).values({ id: companyB, tenantId: db.tenantId, code: 'B', name: 'B' });
});
afterAll(async () => { await db.close(); });

it('loaded but unapplied pack cannot change core required/default fields, hooks or metadata in another company', async () => {
  await expect(db.run({}, (ctx) => repo(ctx, PackItem).create({ name: 'unapplied' }))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  await expect(db.run({}, (ctx) => runAction(ctx, 'scope_pack.check', {}))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  await db.run({}, (ctx) => applyPack(ctx, 'scope_pack'));
  expect(await db.run({}, (ctx) => runAction(ctx, 'scope_pack.check', {}))).toEqual({ ok: true });
  expect(await db.run({}, (ctx) => repo(ctx, PackItem).create({ name: 'applied' }))).toMatchObject({ name: 'applied' });
  await expect(db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'missing tag' }))).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'blocked-by-pack', ext: { requiredTag: 'ok' } }))).rejects.toThrow('pack guard');
  const b = await db.run({ companyId: companyB }, (ctx) => repo(ctx, TPartner).create({ name: 'blocked-by-pack' }));
  expect(b.ext).toBeNull();
  expect(await db.run({ companyId: companyB }, async (ctx) => entityMeta(ctx, TPartner).extFields)).toEqual([]);
  expect(await db.run({}, async (ctx) => entityMeta(ctx, TPartner).extFields.map((field) => field.name))).toEqual(['ext.requiredTag', 'ext.defaultTag']);
  expect(await db.run({ companyId: companyB }, async (ctx) => entityMeta(ctx, TPartner).label)).toEqual(TPartner.config.label);
});

it('an administrator choosing the module default is preserved unless force is explicitly requested', async () => {
  await db.run({ companyId: companyB }, (ctx) => setSetting(ctx, 'scoped.mode', z.string(), 'module-default'));
  const applied = await db.run({ companyId: companyB }, (ctx) => applyPack(ctx, 'scope_pack'));
  expect(applied.settings.kept).toContain('scoped.mode');
  expect(await db.run({ companyId: companyB }, (ctx) => getSetting(ctx, 'scoped.mode', z.string(), 'missing'))).toBe('module-default');
  await db.run({ companyId: companyB }, (ctx) => applyPack(ctx, 'scope_pack', { force: true }));
  expect(await db.run({ companyId: companyB }, (ctx) => getSetting(ctx, 'scoped.mode', z.string(), 'missing'))).toBe('pack-default');
});
