// docs/specs/pack.md AC-6 (with AC-3/AC-5 through a real pack) against Postgres (DB daifuku_test_packs):
// apply writes the setting default and seeds tags, a second apply is a no-op, force re-applies, sample runs once,
// ext validation / filter / search on partner, example.hello, and /meta (appMeta) label override + extFields source.
import {
  appMeta,
  applyPack,
  auditTrail,
  getSetting,
  newId,
  PACKS_APPLIED_KEY,
  readAppliedPacks,
  registerCrudActions,
  registerPackActions,
  registry,
  repo,
  runAction,
  setSetting,
  ValidationError,
  type Context,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Partner } from '@daifuku/mod-partner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_RANK_KEY,
  defaultRankSchema,
  ExamplePack,
  ExampleTag,
  SAMPLE_PARTNER_CODES,
  SEED_TAGS,
} from '../src/index.ts';

let db: TestDb;
let secondCompany: string;
let unappliedCompany: string;
const T1 = new Date('2026-09-11T01:00:00.000Z');
const T2 = new Date('2026-09-12T01:00:00.000Z');
const at = (d: Date) => ({ now: () => d });
const inSecond = (extra: Record<string, unknown> = {}) => ({ companyId: secondCompany, ...extra });

async function companySettings(companyId: string): Promise<Record<string, unknown>> {
  const rows = await db.owner.sql`select settings from companies where id = ${companyId}`;
  return (rows[0]?.settings ?? {}) as Record<string, unknown>;
}
const tagsOf = (ctx: Context) => repo(ctx, ExampleTag).list({ orderBy: [{ field: 'code', dir: 'asc' }] });

beforeAll(async () => {
  registerCrudActions();
  registerPackActions();
  db = await freshDb();
  secondCompany = newId();
  await db.owner
    .sql`insert into companies (id, tenant_id, code, name) values (${secondCompany}, ${db.tenantId}, 'T2', 'Second Co')`;
  unappliedCompany = newId();
  await db.owner
    .sql`insert into companies (id, tenant_id, code, name) values (${unappliedCompany}, ${db.tenantId}, 'T3', 'Unapplied Co')`;
});
afterAll(async () => {
  await db.close();
});

describe('pack example: definition (AC-1, AC-2, AC-6)', () => {
  it('AC-2 importing the package registers the pack, its ext (source pack:example), entity, action and label override', () => {
    expect(registry.packs().map((p) => p.name)).toContain('example');
    expect(ExamplePack.version).toBe('0.1.0');
    expect(registry.extFields('partner').map((d) => [d.key, d.source])).toEqual([
      ['customerRank', 'pack:example'],
      ['note2', 'pack:example'],
    ]);
    expect(ExampleTag.module).toBe('example');
    expect(registry.action('example.hello').module).toBe('example');
    expect(registry.hasAction('example_tag.create')).toBe(true);
    expect(registry.labelOverrides('partner')?.entity).toEqual({ ja: '得意先/仕入先', en: 'Customer/Supplier' });
    expect(registry.hasSetting(DEFAULT_RANK_KEY)).toBe(true);
  });
});

describe('pack example: apply (AC-3, AC-6)', () => {
  it('AC-3 first apply writes the setting default, seeds 3 tags, records packs.applied; no sample without the flag', async () => {
    const res = await db.run(at(T1), (ctx) => applyPack(ctx, 'example'));
    expect(res).toMatchObject({
      name: 'example',
      version: '0.1.0',
      alreadyApplied: false,
      seeded: true,
      sampled: false,
      settings: { written: [DEFAULT_RANK_KEY], kept: [] },
    });
    expect(await db.run({}, (ctx) => getSetting(ctx, DEFAULT_RANK_KEY, defaultRankSchema, 'C'))).toBe('B');
    const tags = await db.run({}, tagsOf);
    expect(tags.items.map((t) => t.code)).toEqual(SEED_TAGS.map((t) => t.code).sort());
    expect((await companySettings(db.companyId))[PACKS_APPLIED_KEY]).toEqual({
      example: { at: T1.toISOString(), version: '0.1.0' },
    });
    expect(await db.run({}, (ctx) => repo(ctx, Partner).count({ code: { $in: [...SAMPLE_PARTNER_CODES] } }))).toBe(0);
  });

  it('AC-3 second apply is a no-op: nothing written (tag versions, settings, audit rows unchanged)', async () => {
    const before = await db.run({}, tagsOf);
    const settingsBefore = await companySettings(db.companyId);
    const auditBefore = await db.run({}, (ctx) => auditTrail(ctx, 'company_settings', db.companyId));
    const res = await db.run(at(T2), (ctx) => applyPack(ctx, 'example'));
    expect(res).toMatchObject({
      alreadyApplied: true,
      seeded: false,
      sampled: false,
      settings: { written: [] },
      record: { at: T1.toISOString(), version: '0.1.0' },
    });
    const after = await db.run({}, tagsOf);
    expect(after.items.map((t) => [t.code, t.version])).toEqual(before.items.map((t) => [t.code, t.version]));
    expect(await companySettings(db.companyId)).toEqual(settingsBefore);
    expect(await db.run({}, (ctx) => auditTrail(ctx, 'company_settings', db.companyId))).toHaveLength(
      auditBefore.length,
    );
  });

  it("AC-3 an admin's explicit setting is kept on first apply; force overwrites it and re-runs seed (idempotent)", async () => {
    await db.run(inSecond(), (ctx) => setSetting(ctx, DEFAULT_RANK_KEY, defaultRankSchema, 'C'));
    const first = await db.run(inSecond(at(T1)), (ctx) => applyPack(ctx, 'example'));
    expect(first.settings).toEqual({ written: [], kept: [DEFAULT_RANK_KEY] });
    expect(await db.run(inSecond(), (ctx) => getSetting(ctx, DEFAULT_RANK_KEY, defaultRankSchema, 'A'))).toBe('C');
    expect((await db.run(inSecond(), tagsOf)).total).toBe(3);

    const forced = await db.run(inSecond(at(T2)), (ctx) => applyPack(ctx, 'example', { force: true }));
    expect(forced).toMatchObject({
      alreadyApplied: true,
      seeded: true,
      settings: { written: [DEFAULT_RANK_KEY], kept: [] },
      record: { at: T2.toISOString() },
    });
    expect(await db.run(inSecond(), (ctx) => getSetting(ctx, DEFAULT_RANK_KEY, defaultRankSchema, 'A'))).toBe('B');
    expect((await db.run(inSecond(), tagsOf)).total).toBe(3);
    // the first company is untouched by the second company's applies
    expect((await companySettings(db.companyId))[PACKS_APPLIED_KEY]).toEqual({
      example: { at: T1.toISOString(), version: '0.1.0' },
    });
  });

  it('AC-3 sample: runs on an applied pack once (2 ranked partners, default rank from the setting), then not again', async () => {
    const res = await db.run(at(T2), (ctx) => applyPack(ctx, 'example', { sample: true }));
    expect(res).toMatchObject({
      alreadyApplied: true,
      seeded: false,
      sampled: true,
      record: { at: T1.toISOString(), sampledAt: T2.toISOString() },
    });
    const partners = await db.run({}, (ctx) =>
      repo(ctx, Partner).list({
        where: { code: { $in: [...SAMPLE_PARTNER_CODES] } },
        orderBy: [{ field: 'code', dir: 'asc' }],
      }),
    );
    expect(partners.items.map((p) => [p.code, p.ext])).toEqual([
      ['EX-0001', { customerRank: 'A', note2: '年間契約あり' }],
      ['EX-0002', { customerRank: 'B', note2: 'スポット取引' }],
    ]);
    const again = await db.run(at(T2), (ctx) => applyPack(ctx, 'example', { sample: true }));
    expect(again.sampled).toBe(false);
    expect(await db.run({}, (ctx) => repo(ctx, Partner).count({ code: { $in: [...SAMPLE_PARTNER_CODES] } }))).toBe(2);
  });

  it('AC-4 pack.apply is admin-only (PERMISSION_DENIED for sales); pack.list shows applied status per company', async () => {
    const sales = { roles: ['sales'], actor: { type: 'user' as const, id: newId() } };
    await expect(db.run(sales, (ctx) => runAction(ctx, 'pack.apply', { name: 'example' }))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(db.run({}, (ctx) => runAction(ctx, 'pack.apply', { name: 'nope' }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
      hint: expect.stringContaining('example'),
    });
    const listed = (await db.run(sales, (ctx) => runAction(ctx, 'pack.list', {}))) as {
      items: Record<string, unknown>[];
    };
    expect(listed.items).toEqual([
      {
        name: 'example',
        label: ExamplePack.label,
        version: '0.1.0',
        depends: ['partner'],
        hasSample: true,
        applied: true,
        appliedAt: T1.toISOString(),
        appliedVersion: '0.1.0',
        sampledAt: T2.toISOString(),
      },
    ]);
  });
});

describe('pack example: ext on partner and example.hello (AC-6)', () => {
  it('AC-6 partner create with a bad rank -> ValidationError on ext.customerRank; nothing written', async () => {
    const before = await db.run({}, (ctx) => repo(ctx, Partner).count());
    const err = await db
      .run({}, (ctx) => repo(ctx, Partner).create({ name: 'Bad rank', ext: { customerRank: 'Z' } }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({ details: { issues: [{ path: 'ext.customerRank' }] } });
    expect(await db.run({}, (ctx) => repo(ctx, Partner).count())).toBe(before);
  });

  it("AC-6 list where ext.customerRank = 'A', search by the searchable ext note2, example.hello counts rank A", async () => {
    await db.run({}, (ctx) => repo(ctx, Partner).create({ name: 'Rank C Co', ext: { customerRank: 'C' } }));
    const rankA = await db.run({}, (ctx) => repo(ctx, Partner).list({ where: { 'ext.customerRank': 'A' } }));
    expect(rankA.items.map((p) => p.code)).toEqual(['EX-0001']);
    const found = await db.run({}, (ctx) => repo(ctx, Partner).list({ search: 'スポット' }));
    expect(found.items.map((p) => p.code)).toEqual(['EX-0002']);
    expect(await db.run({}, (ctx) => runAction(ctx, 'example.hello', {}))).toEqual({ count: 1 });
  });
});

describe('pack example: /meta (AC-5, AC-6)', () => {
  it('AC-5 appMeta: partner label override, extFields with source pack:example, packs[].applied, pack menu', async () => {
    const meta = await db.run({}, async (ctx) =>
      appMeta(ctx, { appliedPacks: Object.keys(await readAppliedPacks(ctx)) }),
    );
    const partner = meta.entities.find((e) => e.name === 'partner');
    expect(partner?.label).toEqual({ ja: '得意先/仕入先', en: 'Customer/Supplier' });
    expect(partner?.fields.find((f) => f.name === 'name')?.label).toEqual({ ja: '名称', en: 'Name' });
    expect(partner?.extFields.map((x) => ({ name: x.name, source: x.source, searchable: x.searchable }))).toEqual([
      { name: 'ext.customerRank', source: 'pack:example', searchable: undefined },
      { name: 'ext.note2', source: 'pack:example', searchable: true },
    ]);
    expect(partner?.extFields[0]?.values).toEqual(['A', 'B', 'C']);
    expect(meta.packs).toEqual([{ name: 'example', label: ExamplePack.label, applied: true }]);
    expect(meta.modules.find((m) => m.name === 'example')?.menus).toEqual([
      { label: { ja: 'タグ', en: 'Tags' }, entity: 'example_tag', order: 90 },
    ]);
    expect(meta.entities.find((e) => e.name === 'example_tag')?.module).toBe('example');
    const unapplied = await db.run(
      { companyId: unappliedCompany, roles: ['viewer'], actor: { type: 'user' as const, id: newId() } },
      async (ctx) => appMeta(ctx),
    );
    expect(unapplied.packs).toEqual([{ name: 'example', label: ExamplePack.label, applied: false }]);
    expect(unapplied.modules.some((m) => m.name === 'example')).toBe(false);
    expect(unapplied.entities.some((e) => e.name === 'example_tag')).toBe(false);
    expect(unapplied.entities.find((e) => e.name === 'partner')?.extFields).toEqual([]);
  });
});
