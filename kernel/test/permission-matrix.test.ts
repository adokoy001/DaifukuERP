// docs/specs/access-insight.md AC-1..AC-4 and AC-3a (no DB): a registry of this file's own (roles, row rules with self,
// condition, $or, $ne and docstatus, field groups, store / parent / sharedRead / site policies and one added with
// registerStoreAccess, relay access, named transitions, documents and plain entities, a pack's entity and action,
// `audit: 'none'`, module role labels) is derived into the matrix, and every cell is compared with the engine itself:
// can() for grants and the store/site/relay notes, canRunAction() for actions, and transitionDocument's rule (built from
// can()) for named transitions.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { availableRoles } from '../src/access-admin-common.ts';
import { canRunAction } from '../src/actions/run.ts';
import { registerCrudActions } from '../src/actions/crud.ts';
import type { Context, ContextParams, Db } from '../src/context.ts';
import { makeContext } from '../src/db/client.ts';
import { defineAction } from '../src/dsl/action.ts';
import { defineDocument, defineEntity } from '../src/dsl/entity.ts';
import { f } from '../src/dsl/fields.ts';
import { defineModule } from '../src/dsl/module.ts';
import { definePack } from '../src/dsl/pack.ts';
import type { Op } from '../src/dsl/types.ts';
import { label } from '../src/i18n.ts';
import { ACCESS_INSIGHT_ROLES, HEALTH_ROLES, KERNEL_CAPABILITIES, SETTINGS_ROLES } from '../src/kernel-capabilities.ts';
import {
  derivePermissionMatrix,
  describeRowRule,
  isSelfRule,
  permissionMatrix,
  type MatrixEntity,
} from '../src/permission-matrix.ts';
import { can } from '../src/permissions.ts';
import { registry } from '../src/registry.ts';
import { registerStoreAccess, storePolicy } from '../src/store-access.ts';

const Store = defineEntity({
  name: 'pmx_store',
  label: label('店舗', 'Store'),
  fields: { name: f.text({ required: true, label: label('店名', 'Store name') }) },
  storeAccess: { kind: 'store', field: 'id' },
  permissions: { roles: { pmx_clerk: ['read'], pmx_viewer: ['read'] } },
});
const Item = defineEntity({
  name: 'pmx_item',
  label: label('品目', 'Item'),
  fields: {
    name: f.text({ required: true, label: label('名称', 'Name') }),
    ownerId: f.uuid({ label: label('担当者', 'Owner') }),
    shared: f.bool({ label: label('共有', 'Shared') }),
    cost: f.decimal({ label: label('原価', 'Cost') }),
    storeId: f.ref('pmx_store', { required: true, label: label('店舗', 'Store') }),
    kind: f.enum(['goods', 'service'], {
      label: label('区分', 'Kind'),
      labels: { goods: label('物品', 'Goods'), service: label('役務', 'Service') },
    }),
  },
  storeAccess: { kind: 'store', field: 'storeId' },
  siteAccess: { kind: 'sharedRead' },
  relayAccess: { operations: ['read', 'create', 'delete'], field: 'storeId' },
  permissions: {
    roles: {
      // `submit` on a plain entity is out of the matrix (decision 11).
      pmx_clerk: ['read', 'create', 'update', 'delete', 'export', 'submit'],
      pmx_owner: ['read', 'create', 'update'],
      pmx_viewer: ['read'],
      relay: ['read', 'create'],
    },
    rowRules: [
      { roles: ['pmx_owner'], where: { ownerId: '$ctx.userId' } },
      { roles: ['pmx_viewer'], where: { $or: [{ ownerId: '$ctx.userId' }, { shared: true }] } },
    ],
    fieldGroups: { costing: { fields: ['cost'], roles: ['pmx_clerk'] } },
  },
});
const Doc = defineDocument({
  name: 'pmx_doc',
  label: label('依頼書', 'Request'),
  naming: { type: 'sequence', prefix: 'PMX-' },
  fields: {
    itemId: f.ref('pmx_item', { required: true, label: label('品目', 'Item') }),
    memo: f.text({ label: label('メモ', 'Memo') }),
  },
  storeAccess: { kind: 'parent', field: 'itemId', entity: 'pmx_item' },
  transitions: {
    // pmx_approver_lite holds the transition role and `submit` but not `update`: transitionDocument refuses it.
    approve: { from: 0, to: 1, roles: ['pmx_approver', 'pmx_approver_lite'], guard: 'pmx_ready' },
    void: { from: 1, to: 2, roles: ['pmx_clerk'] },
    // No `roles`: every role with `update` and `cancel` may run it.
    retract: { from: 1, to: 2 },
  },
  permissions: {
    roles: {
      pmx_clerk: ['read', 'create', 'update', 'submit', 'cancel', 'amend', 'export'],
      pmx_approver: ['read', 'update', 'submit'],
      pmx_approver_lite: ['read', 'submit'],
      pmx_submitter: ['read', 'submit'],
      pmx_canceller: ['read', 'update', 'cancel'],
      pmx_viewer: ['read'],
    },
    rowRules: [{ roles: ['pmx_viewer'], where: { docstatus: 1 } }],
  },
});
const Log = defineEntity({
  name: 'pmx_log',
  label: label('記録', 'Log'),
  scope: 'tenant',
  audit: 'none',
  fields: { userId: f.uuid({ label: label('利用者', 'User') }), note: f.text() },
  storeAccess: { kind: 'sharedRead' },
  permissions: {
    roles: { pmx_clerk: ['read', 'create'], pmx_viewer: ['read'] },
    rowRules: [{ roles: ['pmx_clerk'], where: { userId: { $ne: '$ctx.userId' } } }],
  },
});
const Note = defineEntity({
  name: 'pmx_note',
  label: label('覚書', 'Note'),
  fields: {
    title: f.text({ label: label('件名', 'Title') }),
    authorId: f.uuid({ label: label('作成者', 'Author') }),
    size: f.int({ label: label('大きさ', 'Size') }),
    storeId: f.ref('pmx_store', { required: true }),
    closedAt: f.timestamp(),
  },
  permissions: {
    roles: { pmx_viewer: ['read', 'create'], pmx_owner: ['read'] },
    rowRules: [
      { roles: ['pmx_viewer'], where: { authorId: { $in: ['$ctx.userId'] }, title: { $like: 'A%' } } },
      {
        roles: ['pmx_owner'],
        where: { size: { $gte: 1, $lt: 10 }, closedAt: null, $and: [{ storeId: { $ne: null } }] },
      },
    ],
  },
});
registerStoreAccess('pmx_note', { kind: 'store', field: 'storeId' });

const runRoles = defineAction({
  name: 'pmx.approve_all',
  description: label('まとめて承認', 'Approve all'),
  input: z.object({}),
  output: z.object({}),
  permission: { roles: ['pmx_approver'] },
  handler: async () => ({}),
});
const runEntity = defineAction({
  name: 'pmx.close_doc',
  description: label('締める', 'Close'),
  input: z.object({}),
  output: z.object({}),
  permission: { entity: 'pmx_doc', op: 'cancel' },
  storeAccess: true,
  handler: async () => ({}),
});
const runAny = defineAction({
  name: 'pmx.status',
  description: label('状態', 'Status'),
  input: z.object({}),
  output: z.object({}),
  permission: 'authenticated',
  tx: 'none',
  siteAccess: true,
  relayAccess: true,
  handler: async () => ({}),
});
const hidden = defineAction({
  name: 'pmx.internal_sync',
  description: label('内部', 'Internal'),
  input: z.object({}),
  output: z.object({}),
  permission: 'authenticated',
  internal: true,
  handler: async () => ({}),
});
defineModule({
  name: 'pmx',
  label: label('試験業務', 'Test module'),
  depends: [],
  entities: [Store, Item, Doc, Log, Note],
  actions: [runRoles, runEntity, runAny, hidden],
  roles: { pmx_clerk: label('係', 'Clerk'), pmx_viewer: label('閲覧', 'Viewer') },
});

const Crate = defineEntity({
  name: 'pmx_crate',
  label: label('箱', 'Crate'),
  fields: { code: f.text({ required: true }) },
  permissions: { roles: { pmx_packer: ['read', 'create'], pmx_clerk: ['read'] } },
});
const packIt = defineAction({
  name: 'pmxpack.pack_it',
  description: label('梱包', 'Pack'),
  input: z.object({}),
  output: z.object({}),
  permission: { entity: 'pmx_crate', op: 'create' },
  handler: async () => ({}),
});
// A module action whose permission names a pack entity: runnable needs that entity's pack (AC-4).
defineAction({
  name: 'pmx.peek_crate',
  description: label('箱を見る', 'Peek'),
  input: z.object({}),
  output: z.object({}),
  permission: { entity: 'pmx_crate', op: 'read' },
  handler: async () => ({}),
});
definePack({
  name: 'pmxpack',
  label: label('梱包パック', 'Packing pack'),
  depends: ['pmx'],
  entities: [Crate],
  actions: [packIt],
  roles: { pmx_packer: label('梱包係', 'Packer'), pmx_clerk: label('別名の係', 'Other clerk label') },
  labels: { pmx_item: { entity: label('商品（上書き）', 'Product (relabelled)') } },
});
registerCrudActions();

const allPacks = () => registry.packs().map((p) => p.name);
const matrixFor = (appliedPacks: readonly string[] = []) =>
  derivePermissionMatrix({
    entities: registry.allEntities(),
    actions: registry.actions(),
    modules: registry.allModules(),
    packs: registry.packs(),
    roles: availableRoles(),
    appliedPacks,
    storePolicy,
    labelOverride: (entity) => registry.labelOverrides(entity, appliedPacks),
    extFields: (entity) => registry.extFields(entity),
  });
const entityOf = (m: ReturnType<typeof matrixFor>, name: string): MatrixEntity => {
  const e = m.entities.find((x) => x.name === name);
  if (!e) throw new Error(`missing ${name}`);
  return e;
};
const ctxOf = (params: Partial<ContextParams>): Context =>
  makeContext({} as unknown as Db, {
    tenantId: '00000000-0000-0000-0000-000000000001',
    companyId: '00000000-0000-0000-0000-0000000000c1',
    actor: { type: 'user', id: 'u-1' },
    roles: [],
    ...params,
  });

describe('permission matrix: derivation (access-insight AC-1, AC-2)', () => {
  const m = matrixFor();

  it('AC-1: ops in OPS order, admin first as the implicit role, labels from the first module/pack declaration', () => {
    expect(m.ops).toEqual(['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend', 'export']);
    expect(m.roles[0]).toMatchObject({ name: 'admin', implicitAll: true });
    expect(m.roles.map((r) => r.name)).toEqual(['admin', ...availableRoles().filter((r) => r !== 'admin')]);
    expect(m.roles.find((r) => r.name === 'pmx_clerk')?.label).toEqual(label('係', 'Clerk'));
    expect(m.roles.find((r) => r.name === 'pmx_packer')?.label).toEqual(label('梱包係', 'Packer'));
    // No declaration: the role name itself. `relay` is a machine role, never a column (decision 9).
    expect(m.roles.find((r) => r.name === 'pmx_approver')?.label).toEqual(label('pmx_approver', 'pmx_approver'));
    expect(m.roles.some((r) => r.name === 'relay')).toBe(false);
  });

  it('AC-2: every registry entity appears exactly once, with its module, kind, scope, pack and ops', () => {
    expect(m.entities.map((e) => e.name).sort()).toEqual(
      registry
        .allEntities()
        .map((e) => e.name)
        .sort(),
    );
    const item = entityOf(m, 'pmx_item');
    expect(item).toMatchObject({ module: 'pmx', kind: 'entity', scope: 'company', pack: null, applied: true });
    expect(item.moduleLabel).toEqual(label('試験業務', 'Test module'));
    expect(item.ops).toEqual(['read', 'create', 'update', 'delete', 'export']);
    expect(item.grants.pmx_clerk).toEqual(['read', 'create', 'update', 'delete', 'export']);
    expect(entityOf(m, 'pmx_doc').ops).toHaveLength(8);
    expect(entityOf(m, 'pmx_log').scope).toBe('tenant');
    expect(entityOf(m, 'pmx_crate')).toMatchObject({ pack: 'pmxpack', applied: false });
    expect(entityOf(matrixFor(['pmxpack']), 'pmx_crate').applied).toBe(true);
  });

  it('AC-1: pack label overrides apply only when the pack is applied', () => {
    expect(entityOf(m, 'pmx_item').label).toEqual(label('品目', 'Item'));
    expect(entityOf(matrixFor(['pmxpack']), 'pmx_item').label).toEqual(label('商品（上書き）', 'Product (relabelled)'));
  });

  it('AC-2: grants[role] has op exactly when can({ roles: [role], accessScope: "all", appliedPacks }) allows it', () => {
    let compared = 0;
    for (const e of m.entities) {
      const def = registry.entity(e.name);
      for (const role of m.roles.map((r) => r.name)) {
        for (const op of e.ops) {
          const allowed = can({ roles: [role], accessScope: 'all', appliedPacks: e.pack ? [e.pack] : [] }, def, op);
          expect(e.grants[role]?.includes(op) ?? false, `${e.name} ${role} ${op}`).toBe(allowed);
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(200);
  });
});

describe('permission matrix: notes (access-insight AC-3)', () => {
  const m = matrixFor();

  it('AC-3(a): row-rule summaries in Japanese and English with labels, tokens and docstatus names', () => {
    const item = entityOf(m, 'pmx_item');
    expect(item.rowRules[0]?.summary).toEqual(label('担当者 = 自分', 'Owner = yourself'));
    expect(item.rowRules[1]?.summary).toEqual(
      label('（担当者 = 自分 または 共有 = はい）', '(Owner = yourself or Shared = yes)'),
    );
    expect(entityOf(m, 'pmx_doc').rowRules[0]?.summary).toEqual(label('状態 = 確定', 'Status = submitted'));
    expect(entityOf(m, 'pmx_log').rowRules[0]?.summary).toEqual(label('利用者 ≠ 自分', 'User ≠ yourself'));
    const note = entityOf(m, 'pmx_note');
    expect(note.rowRules[0]?.summary).toEqual(
      label('作成者が次のいずれか: 自分 かつ 件名が「A%」に一致', 'Author is one of: yourself and Title matches "A%"'),
    );
    expect(note.rowRules[1]?.summary.ja).toBe('大きさ ≥ 1 かつ 大きさ < 10 かつ closedAtが空 かつ storeIdが空でない');
    expect(note.rowRules[1]?.summary.en).toBe('Size ≥ 1 and Size < 10 and closedAt is empty and storeId is not empty');
    expect(
      describeRowRule(registry.entity('pmx_item'), {
        kind: 'service',
        storeId: '$ctx.companyId',
        name: '$ctx.tenantId',
      }),
    ).toEqual(
      label(
        '区分 = 役務 かつ 店舗 = 現在の会社 かつ 名称 = 現在のテナント',
        'Kind = Service and Store = the current company and Name = the current tenant',
      ),
    );
  });

  it('AC-3(a): an operator the summary does not know falls back to the raw where JSON', () => {
    const where = { name: { $regex: 'x' } } as never;
    expect(describeRowRule(registry.entity('pmx_item'), where)).toEqual(
      label(JSON.stringify(where), JSON.stringify(where)),
    );
  });

  it('AC-3(a): self only for a top-level equality or token-only $in; $or and $ne are conditional', () => {
    const item = entityOf(m, 'pmx_item');
    expect(item.rowRules.map((r) => r.self)).toEqual([true, false]);
    expect(entityOf(m, 'pmx_log').rowRules[0]?.self).toBe(false);
    expect(entityOf(m, 'pmx_note').rowRules[0]?.self).toBe(true);
    expect(isSelfRule({ ownerId: '$ctx.actorId' })).toBe(true);
    expect(isSelfRule({ ownerId: { $in: ['$ctx.userId', 'someone'] } })).toBe(false);
    expect(isSelfRule({ $and: [{ ownerId: '$ctx.userId' }] })).toBe(false);
    expect(isSelfRule({ ownerId: '$ctx.companyId' })).toBe(false);
  });

  it('AC-3(a): restrictedOps are the role grants except create (row rules do not limit created values)', () => {
    const item = entityOf(m, 'pmx_item');
    expect(item.grants.pmx_owner).toContain('create');
    expect(item.rowRules[0]?.restrictedOps).toEqual({ pmx_owner: ['read', 'update'] });
    expect(entityOf(m, 'pmx_log').rowRules[0]?.restrictedOps).toEqual({ pmx_clerk: ['read'] });
  });

  it('AC-3(b): field groups with labelled fields and the roles that read them', () => {
    expect(entityOf(m, 'pmx_item').fieldGroups).toEqual([
      { name: 'costing', fields: [{ name: 'cost', label: label('原価', 'Cost') }], roles: ['pmx_clerk'] },
    ]);
  });

  it('AC-3(c): store and site policies (incl. registerStoreAccess and parent labels) and the allowed ops', () => {
    const item = entityOf(m, 'pmx_item');
    expect(item.stores.policy).toEqual({ kind: 'store', field: 'storeId', fieldLabel: label('店舗', 'Store') });
    expect(item.stores.allowedOps).toEqual(['read', 'create', 'update', 'delete', 'export']);
    expect(item.sites).toMatchObject({
      policy: { kind: 'sharedRead' },
      allowedOps: ['read', 'export'],
      sharedReadAnyRole: true,
    });
    const doc = entityOf(m, 'pmx_doc');
    expect(doc.stores.policy).toEqual({
      kind: 'parent',
      field: 'itemId',
      entity: 'pmx_item',
      entityLabel: label('品目', 'Item'),
    });
    expect(doc.stores.allowedOps).not.toContain('submit');
    expect(entityOf(m, 'pmx_note').stores.policy).toMatchObject({ kind: 'store', field: 'storeId' });
    expect(entityOf(m, 'pmx_crate').stores).toMatchObject({ policy: null, allowedOps: [], sharedReadAnyRole: false });
  });

  it('AC-3(c): each role effective op under stores/sites scope equals can() with that scope', () => {
    let compared = 0;
    for (const e of m.entities) {
      const def = registry.entity(e.name);
      for (const scope of ['stores', 'sites'] as const) {
        const note = scope === 'stores' ? e.stores : e.sites;
        for (const role of m.roles.map((r) => r.name)) {
          for (const op of e.ops) {
            const allowed = can({ roles: [role], accessScope: scope, appliedPacks: e.pack ? [e.pack] : [] }, def, op);
            expect(note.effective[role]?.includes(op) ?? false, `${e.name} ${scope} ${role} ${op}`).toBe(allowed);
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(400);
  });

  it('AC-3(d): relay operations are the intersection with the relay role, as can() decides for a relay actor', () => {
    const item = entityOf(m, 'pmx_item');
    expect(item.relay).toEqual({
      operations: ['read', 'create', 'delete'],
      field: 'storeId',
      effective: ['read', 'create'],
    });
    for (const op of item.ops)
      expect(item.relay?.effective.includes(op), op).toBe(
        can(
          { roles: ['relay'], accessScope: 'all', appliedPacks: [], actor: { type: 'relay', id: 'gw' } },
          registry.entity('pmx_item'),
          op,
        ),
      );
    expect(entityOf(m, 'pmx_doc').relay).toBeNull();
  });

  it('AC-3(e): audit none is flagged (changes are not audited; CSV exports still are)', () => {
    expect(entityOf(m, 'pmx_log').auditChanges).toBe(false);
    expect(entityOf(m, 'pmx_item').auditChanges).toBe(true);
  });

  it('AC-3(f): named transitions follow transitionDocument (role or admin, update, submit/cancel) and submitVia', () => {
    const doc = entityOf(m, 'pmx_doc');
    expect(doc.transitions.map((t) => [t.name, t.from, t.to, t.roles, t.guard])).toEqual([
      ['approve', 0, 1, ['pmx_approver', 'pmx_approver_lite'], true],
      ['void', 1, 2, ['pmx_clerk'], false],
      ['retract', 1, 2, null, false],
    ]);
    expect(doc.submitVia).toEqual(['approve']);
    // pmx_submitter has `submit` but neither the transition role nor `update`: plain submit (via approve) is refused.
    expect(doc.grants.pmx_submitter).toContain('submit');
    // pmx_approver_lite holds the transition role and `submit` but lacks `update`: refused (the `update` requirement).
    expect(doc.grants.pmx_approver_lite).toEqual(['read', 'submit']);
    const runnable = (name: string) => doc.transitions.find((t) => t.name === name)?.runnableRoles;
    expect(runnable('approve')).toEqual(['admin', 'pmx_approver']);
    expect(runnable('void')).toEqual(['admin', 'pmx_clerk']);
    // A transition without roles is open to every role with `update` and `cancel` (the `!t.roles` branch), while
    // `void` (roles: pmx_clerk) refuses pmx_canceller although it holds both.
    expect(runnable('retract')).toEqual(['admin', 'pmx_canceller', 'pmx_clerk']);
    expect(runnable('void')).not.toContain('pmx_canceller');
    const def = registry.entity('pmx_doc');
    for (const t of doc.transitions) {
      const target: Op = t.to === 1 ? 'submit' : 'cancel';
      for (const role of m.roles.map((r) => r.name)) {
        const ctx = { roles: [role], accessScope: 'all' as const, appliedPacks: [] };
        const expected =
          (!t.roles || t.roles.includes(role) || role === 'admin') && can(ctx, def, 'update') && can(ctx, def, target);
        expect(t.runnableRoles.includes(role), `${t.name} ${role}`).toBe(expected);
      }
    }
    expect(entityOf(m, 'pmx_item').submitVia).toEqual([]);
  });
});

describe('permission matrix: actions (access-insight AC-4)', () => {
  const m = matrixFor();

  it('AC-4: generic and internal actions are left out; entry permissions are described', () => {
    const names = m.actions.map((a) => a.name);
    expect(names).toEqual(
      expect.arrayContaining(['pmx.approve_all', 'pmx.close_doc', 'pmx.status', 'pmxpack.pack_it']),
    );
    expect(names).not.toContain('pmx.internal_sync');
    expect(names.some((n) => n.startsWith('pmx_item.'))).toBe(false);
    expect(m.actions.find((a) => a.name === 'pmx.close_doc')).toMatchObject({
      permission: { kind: 'entity', entity: 'pmx_doc', op: 'cancel', entityLabel: label('依頼書', 'Request') },
      storeAccess: true,
      siteAccess: false,
    });
    expect(m.actions.find((a) => a.name === 'pmx.status')).toMatchObject({
      permission: { kind: 'authenticated' },
      siteAccess: true,
      relayAccess: true,
      mutates: false,
    });
    expect(m.actions.find((a) => a.name === 'pmx.approve_all')?.permission).toEqual({
      kind: 'roles',
      roles: ['pmx_approver'],
    });
  });

  it('AC-4: applied follows the action pack and the pack of the entity its permission names', () => {
    expect(m.actions.find((a) => a.name === 'pmxpack.pack_it')).toMatchObject({ pack: 'pmxpack', applied: false });
    expect(m.actions.find((a) => a.name === 'pmx.peek_crate')).toMatchObject({ pack: null, applied: false });
    const applied = matrixFor(['pmxpack']);
    expect(applied.actions.find((a) => a.name === 'pmx.peek_crate')?.applied).toBe(true);
  });

  it('AC-4: runnable equals canRunAction with company-wide access and every loaded pack applied', () => {
    let compared = 0;
    for (const a of m.actions) {
      const def = registry.action(a.name);
      for (const role of m.roles.map((r) => r.name)) {
        const ctx = ctxOf({ roles: [role], accessScope: 'all', appliedPacks: allPacks() });
        expect(a.runnable.includes(role), `${a.name} ${role}`).toBe(canRunAction(ctx, def));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(30);
  });
});

describe('permission matrix: kernel capabilities and access (access-insight AC-3a, AC-5)', () => {
  it('AC-3a: the kernel legend is built from the constants the checks use', () => {
    const m = matrixFor();
    const byId = Object.fromEntries(m.kernel.map((c) => [c.id, c]));
    expect(byId.company_settings?.roles).toEqual([...SETTINGS_ROLES]);
    expect(byId.setup_health?.roles).toEqual([...HEALTH_ROLES]);
    expect(byId.access_insight?.roles).toEqual([...ACCESS_INSIGHT_ROLES]);
    expect(byId.access_admin).toMatchObject({ roles: [], tenantAdmin: true });
    expect(m.kernel).toHaveLength(KERNEL_CAPABILITIES.length);
    expect(SETTINGS_ROLES).toContain('settings');
  });

  it('AC-5: admin with company-wide access as a user or an agent for a user; others are refused', () => {
    expect(() => permissionMatrix(ctxOf({ roles: ['admin'], accessScope: 'all' }))).not.toThrow();
    expect(() =>
      permissionMatrix(ctxOf({ roles: ['admin'], actor: { type: 'agent', id: 'claude', onBehalfOf: 'u-1' } })),
    ).not.toThrow();
    for (const ctx of [
      ctxOf({ roles: ['pmx_clerk'] }),
      ctxOf({ roles: ['admin'], accessScope: 'stores', storeIds: ['s'] }),
      ctxOf({ roles: ['admin'], accessScope: 'sites', siteIds: ['s'] }),
      ctxOf({ roles: ['admin'], actor: { type: 'relay', id: 'gw' } }),
      ctxOf({ roles: ['admin'], actor: { type: 'system', id: 'system' } }),
      ctxOf({ roles: ['admin'], actor: { type: 'agent', id: 'claude' } }),
      ctxOf({ roles: ['admin'], actor: { type: 'machine', id: 'key' } as never }),
    ])
      expect(() => permissionMatrix(ctx), JSON.stringify(ctx.actor)).toThrow(/access_insight/);
  });

  it('AC-5: a tenant administrator without a company sees pack entities and actions as not applied', () => {
    const m = permissionMatrix(ctxOf({ roles: ['admin'], companyId: null, appliedPacks: [] }));
    expect(entityOf(m, 'pmx_crate').applied).toBe(false);
    expect(m.actions.find((a) => a.name === 'pmxpack.pack_it')?.applied).toBe(false);
    expect(m.packs).toEqual([{ name: 'pmxpack', label: label('梱包パック', 'Packing pack'), applied: false }]);
  });
});
