// docs/specs/pack.md AC-1, AC-2, AC-5 (definition time, no DB): definePack registers ext/entities/actions/labels at once,
// checks depends/names/conflicts before registering anything, and /meta shows label overrides and packs.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerPackActions } from '../src/actions/pack.ts';
import type { Context, Db } from '../src/context.ts';
import { makeContext } from '../src/db/client.ts';
import { defineAction } from '../src/dsl/action.ts';
import { defineEntity } from '../src/dsl/entity.ts';
import { f } from '../src/dsl/fields.ts';
import { definePack } from '../src/dsl/pack.ts';
import { Conflict, DependencyError, ValidationError } from '../src/errors.ts';
import { label } from '../src/i18n.ts';
import { appMeta, entityMeta } from '../src/meta.ts';
import { appliedPacksOf, PACKS_APPLIED_KEY } from '../src/pack.ts';
import { registry } from '../src/registry.ts';
import { TMemo, TPartner } from './fixtures/entities.ts';

const ctx: Context = makeContext({} as unknown as Db, {
  tenantId: '00000000-0000-0000-0000-000000000001',
  companyId: null,
  actor: { type: 'user', id: 'u' },
  roles: ['admin'],
});

const Shelf = defineEntity({
  name: 'unitpack_shelf',
  label: label('棚', 'Shelf'),
  fields: { code: f.text({ required: true }), name: f.text() },
  permissions: { roles: { clerk: ['read'] } },
});
const shelfCount = defineAction({
  name: 'unitpack.count_shelves',
  description: label('棚を数える', 'Count shelves'),
  input: z.object({}),
  output: z.object({ n: z.number() }),
  permission: 'authenticated',
  tx: 'none',
  handler: async () => ({ n: 0 }),
});
let hookCalls = 0;
const hooks = () => {
  hookCalls += 1;
};

const UnitPack = definePack({
  name: 'unitpack',
  label: label('単体テストパック', 'Unit pack'),
  depends: ['test'],
  ext: { test_partner: { shelfCode: f.text({ label: label('棚コード', 'Shelf code'), searchable: true }) } },
  entities: [Shelf],
  actions: [shelfCount],
  hooks,
  labels: {
    test_partner: { entity: label('得意先', 'Customer'), fields: { name: label('得意先名', 'Customer name') } },
  },
  menus: [
    { label: label('棚', 'Shelves'), entity: Shelf.name },
    { label: label('レポート', 'Report'), route: '/unitpack/report' },
    { label: label('共通取引先', 'Core partner'), entity: TPartner.name },
  ],
});

function caught(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
}

describe('definePack registers at definition time (AC-1, AC-2)', () => {
  it('AC-2 returns the def (default version) and registers pack, ext with source pack:<name>, ownership, labels; hooks run once', () => {
    expect(UnitPack).toMatchObject({ kind: 'pack', name: 'unitpack', version: '0.0.0' });
    expect(registry.packs()).toEqual([UnitPack]);
    expect(registry.hasPack('unitpack')).toBe(true);
    expect(registry.extFields('test_partner').map((d) => [d.key, d.source])).toEqual([['shelfCode', 'pack:unitpack']]);
    expect(Shelf.module).toBe('unitpack');
    expect(shelfCount.module).toBe('unitpack');
    expect(registry.labelOverrides('test_partner')).toEqual({
      entity: { ja: '得意先', en: 'Customer' },
      fields: { name: { ja: '得意先名', en: 'Customer name' } },
    });
    expect(hookCalls).toBe(1);
  });

  it('AC-2 a pack may depend on another pack', () => {
    const child = definePack({
      name: 'unitpack_child',
      label: label('子', 'Child'),
      version: '1.2.0',
      depends: ['unitpack'],
      labels: { unitpack_shelf: { entity: label('ラック', 'Rack') } },
    });
    expect(child.version).toBe('1.2.0');
    expect(registry.labelOverrides('unitpack_shelf')?.entity).toEqual({ ja: 'ラック', en: 'Rack' });
  });

  it('AC-2 unregistered depends -> DependencyError naming what is missing; nothing registered', () => {
    const e = caught(() =>
      definePack({
        name: 'unitpack_orphan',
        label: label('孤児', 'Orphan'),
        depends: ['test', 'retail_core', 'nope'],
        ext: { test_partner: { orphanKey: f.text() } },
      }),
    );
    expect(e).toBeInstanceOf(DependencyError);
    expect((e as DependencyError).message).toContain('"retail_core", "nope"');
    expect((e as DependencyError).hint).toContain('retail_core, nope');
    expect(registry.hasPack('unitpack_orphan')).toBe(false);
    expect(registry.extFields('test_partner').map((d) => d.key)).not.toContain('orphanKey');
  });

  it('AC-2 ext/labels on an entity whose module is not reachable from depends -> DependencyError; unknown entity too', () => {
    const outside = caught(() =>
      definePack({
        name: 'unitpack_reach',
        label: label('到達', 'Reach'),
        depends: [],
        ext: { test_partner: { reachKey: f.text() } },
      }),
    );
    expect(outside).toBeInstanceOf(DependencyError);
    expect((outside as DependencyError).message).toContain('belongs to "test"');
    const unknown = caught(() =>
      definePack({
        name: 'unitpack_reach',
        label: label('到達', 'Reach'),
        depends: ['test'],
        labels: { no_such_entity: { entity: label('x', 'x') } },
      }),
    );
    expect(unknown).toBeInstanceOf(DependencyError);
    expect(registry.hasPack('unitpack_reach')).toBe(false);
  });

  it('AC-1 bad name, reserved name, unprefixed action, unknown label field -> ValidationError listing each; nothing registered', () => {
    const e = caught(() =>
      definePack({ name: 'Bad-Name', label: label('x', 'x'), depends: [], actions: [shelfCount] }),
    );
    expect(e).toBeInstanceOf(ValidationError);
    expect(((e as ValidationError).details as { issues: { path: string }[] }).issues.map((i) => i.path)).toEqual([
      'name',
      'actions.unitpack.count_shelves',
    ]);
    expect(caught(() => definePack({ name: 'pack', label: label('x', 'x'), depends: [] }))).toBeInstanceOf(
      ValidationError,
    );
    const field = caught(() =>
      definePack({
        name: 'unitpack_lbl',
        label: label('x', 'x'),
        depends: ['test'],
        labels: { test_partner: { fields: { nope: label('x', 'x') } } },
      }),
    );
    expect(((field as ValidationError).details as { issues: { path: string }[] }).issues.map((i) => i.path)).toEqual([
      'labels.test_partner.fields.nope',
    ]);
    expect(registry.packs().map((p) => p.name)).toEqual(['unitpack', 'unitpack_child']);
  });

  it('AC-2 name of a module/pack, entity owned elsewhere -> Conflict', () => {
    expect(caught(() => definePack({ name: 'test', label: label('x', 'x'), depends: [] }))).toBeInstanceOf(Conflict);
    expect(caught(() => definePack({ name: 'unitpack', label: label('x', 'x'), depends: [] }))).toBeInstanceOf(
      Conflict,
    );
    expect(
      caught(() =>
        definePack({ name: 'unitpack_steal', label: label('x', 'x'), depends: ['test'], entities: [TPartner] }),
      ),
    ).toBeInstanceOf(Conflict);
  });

  it('AC-2 ext is all-or-nothing across entities: a Conflict on the second entity leaves the first unregistered', () => {
    const e = caught(() =>
      definePack({
        name: 'unitpack_dup',
        label: label('重複', 'Dup'),
        depends: ['test'],
        ext: { test_memo: { memoTag: f.text() }, test_partner: { shelfCode: f.text() } },
      }),
    );
    expect(e).toBeInstanceOf(Conflict);
    expect((e as Conflict).hint).toContain('"pack:unitpack"');
    expect(registry.extFields(TMemo.name)).toEqual([]);
    expect(registry.hasPack('unitpack_dup')).toBe(false);
  });
});

describe('meta and generic pack actions (AC-4, AC-5)', () => {
  it('AC-5 entityMeta uses the label overrides; untouched fields keep their own labels', () => {
    const meta = entityMeta(ctx, TPartner, { appliedPacks: ['unitpack'] });
    expect(meta.label).toEqual({ ja: '得意先', en: 'Customer' });
    expect(meta.fields.find((x) => x.name === 'name')?.label).toEqual({ ja: '得意先名', en: 'Customer name' });
    expect(meta.fields.find((x) => x.name === 'nameKana')?.label).toEqual({ ja: 'カナ', en: 'Kana' });
    expect(meta.extFields.map((x) => [x.name, x.source])).toEqual([['ext.shelfCode', 'pack:unitpack']]);
    const inactive = entityMeta(ctx, TPartner, { appliedPacks: [] });
    expect(inactive.extFields).toEqual([]);
    expect(inactive.label).toEqual(TPartner.config.label);
  });

  it('AC-5 appMeta.packs carries applied from MetaOptions.appliedPacks; pack menus appear with the modules', () => {
    expect(appMeta(ctx).packs).toEqual([
      { name: 'unitpack', label: UnitPack.label, applied: false },
      { name: 'unitpack_child', label: { ja: '子', en: 'Child' }, applied: false },
    ]);
    expect(appMeta(ctx, { appliedPacks: ['unitpack'] }).packs.map((p) => p.applied)).toEqual([true, false]);
    expect(appMeta(ctx).modules.some((m) => m.name === 'unitpack')).toBe(false);
    expect(
      appMeta(ctx)
        .modules.flatMap((m) => m.menus)
        .some((menu) => menu.route === '/unitpack/report' || menu.label.en === 'Core partner'),
    ).toBe(false);
    expect(appMeta(ctx, { appliedPacks: ['unitpack'] }).modules.find((m) => m.name === 'unitpack')?.menus).toEqual(
      UnitPack.menus,
    );
  });

  it('AC-4 registerPackActions is idempotent, declares packs.applied, and exposes pack.apply (admin, mutates) and pack.list', () => {
    registerPackActions();
    registerPackActions();
    const apply = registry.action('pack.apply');
    expect(apply).toMatchObject({ permission: { roles: ['admin'] }, mutates: true, internal: false, tx: 'required' });
    expect(registry.action('pack.list')).toMatchObject({
      permission: 'authenticated',
      mutates: false,
      siteAccess: true,
      storeAccess: true,
    });
    expect(registry.actions().map((a) => a.name)).toEqual(expect.arrayContaining(['pack.apply', 'pack.list']));
    expect(registry.hasSetting(PACKS_APPLIED_KEY)).toBe(true);
    expect(
      registry
        .setting(PACKS_APPLIED_KEY)
        .schema.safeParse({ unitpack: { at: '2026-09-11T00:00:00.000Z', version: '0.0.0' } }).success,
    ).toBe(true);
  });

  it('AC-3 appliedPacksOf reads packs.applied; a missing or corrupt value reads as nothing applied', () => {
    expect(appliedPacksOf({})).toEqual({});
    expect(appliedPacksOf({ [PACKS_APPLIED_KEY]: 'garbage' })).toEqual({});
    expect(appliedPacksOf({ [PACKS_APPLIED_KEY]: { unitpack: { at: 'x', version: '1' } } })).toEqual({
      unitpack: { at: 'x', version: '1' },
    });
  });
});

// Runs last: it changes a label the meta tests above assert on.
describe('label overrides across packs (AC-2, last-wins)', () => {
  // Behaviour change (Phase 2T integration): label overrides are cosmetic, so two loaded packs relabelling the same
  // entity/field is a recorded warning with the later pack winning — not a Conflict that stops the process
  // (retail and real_estate both relabel partner/sales_invoice and the dev deployment loads both). ADR-0015.
  it('AC-2 labels resolve among applied packs; a registered overlap is still diagnosed', () => {
    const before = registry.warnings().length;
    const meta0 = entityMeta(ctx, TPartner, { appliedPacks: ['unitpack'] });
    expect(meta0.fields.find((x) => x.name === 'name')?.label).toEqual({ ja: '得意先名', en: 'Customer name' });
    definePack({
      name: 'unitpack_relabel',
      label: label('x', 'x'),
      depends: ['test'],
      labels: { test_partner: { fields: { name: label('顧客名', 'Client') } } },
    });
    expect(registry.hasPack('unitpack_relabel')).toBe(true);
    const warnings = registry.warnings().slice(before);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe('label_override');
    expect(warnings[0]?.message).toContain('test_partner.name');
    expect(warnings[0]?.message).toContain('"unitpack"');
    expect(
      entityMeta(ctx, TPartner, { appliedPacks: ['unitpack', 'unitpack_relabel'] }).fields.find(
        (x) => x.name === 'name',
      )?.label,
    ).toEqual({ ja: '顧客名', en: 'Client' });
    expect(
      entityMeta(ctx, TPartner, { appliedPacks: ['unitpack'] }).fields.find((x) => x.name === 'name')?.label,
    ).toEqual({ ja: '得意先名', en: 'Customer name' });
  });
});
