// docs/specs/access-insight.md AC-6, AC-7: the permission matrix screen helpers — URL round trip, module / role / name
// filters, abbreviations with full names, the role-only view (default on a narrow screen), unapplied packs, badges, the
// submit-via-transition note, and the store/site policy text. The matrix below is a hand-made response of the API.
import { describe, expect, it } from 'vitest';
import {
  BADGE_TEXT,
  cellText,
  entityBadges,
  filterActions,
  filterEntities,
  groupByModule,
  kernelCapabilitiesOf,
  moduleOptions,
  OP_TEXT,
  parsePermissionsSearch,
  permissionsSearchParams,
  permissionText,
  policyText,
  submitNote,
  viewRole,
  type MatrixEntity,
  type MatrixScopeNote,
  type PermissionMatrix,
} from './permission-matrix.ts';

const none: MatrixScopeNote = { policy: null, allowedOps: [], sharedReadAnyRole: false, effective: {} };
function entity(name: string, extra: Partial<MatrixEntity> = {}): MatrixEntity {
  return {
    name,
    label: { ja: `${name}の表`, en: `${name} table` },
    module: 'sales',
    moduleLabel: { ja: '販売', en: 'Sales' },
    kind: 'entity',
    scope: 'company',
    pack: null,
    applied: true,
    ops: ['read', 'create', 'update', 'delete', 'export'],
    grants: { admin: ['read', 'create', 'update', 'delete', 'export'], sales: ['read', 'create'] },
    rowRules: [],
    fieldGroups: [],
    stores: none,
    sites: none,
    relay: null,
    auditChanges: true,
    transitions: [],
    submitVia: [],
    ...extra,
  };
}
const matrix: PermissionMatrix = {
  ops: ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend', 'export'],
  roles: [
    { name: 'admin', label: { ja: '管理者', en: 'Administrator' }, implicitAll: true },
    { name: 'sales', label: { ja: '営業', en: 'Sales' }, implicitAll: false },
    { name: 'settings', label: { ja: '設定管理', en: 'Settings' }, implicitAll: false },
  ],
  entities: [
    entity('partner', {
      module: 'partner',
      moduleLabel: { ja: '取引先', en: 'Partners' },
      label: { ja: '取引先', en: 'Partner' },
      rowRules: [
        {
          roles: ['sales'],
          where: {},
          summary: { ja: '担当 = 自分', en: 'Owner = yourself' },
          self: true,
          restrictedOps: {},
        },
      ],
    }),
    entity('payment', {
      kind: 'document',
      rowRules: [
        {
          roles: ['sales'],
          where: {},
          summary: { ja: '区分 = 入金', en: 'Direction = Receipt' },
          self: false,
          restrictedOps: {},
        },
      ],
      fieldGroups: [
        { name: 'bank', fields: [{ name: 'iban', label: { ja: '口座', en: 'Account' } }], roles: ['accounting'] },
      ],
      stores: {
        policy: { kind: 'sharedRead' },
        allowedOps: ['read', 'export'],
        sharedReadAnyRole: true,
        effective: {},
      },
      submitVia: ['approve'],
    }),
    entity('crate', {
      module: 'retail',
      moduleLabel: { ja: '小売パック', en: 'Retail pack' },
      pack: 'retail',
      applied: false,
      auditChanges: false,
      scope: 'tenant',
      relay: { operations: ['read'], field: 'storeId', effective: ['read'] },
    }),
  ],
  actions: [
    {
      name: 'sales.confirm_order',
      description: { ja: '受注を確定', en: 'Confirm an order' },
      module: 'sales',
      moduleLabel: { ja: '販売', en: 'Sales' },
      pack: null,
      applied: true,
      mutates: true,
      permission: {
        kind: 'entity',
        entity: 'sales_order',
        op: 'submit',
        entityLabel: { ja: '受注', en: 'Sales order' },
      },
      storeAccess: false,
      siteAccess: false,
      relayAccess: false,
      runnable: ['admin', 'sales'],
    },
    {
      name: 'retail.close_register',
      description: { ja: 'レジ締め', en: 'Close the register' },
      module: 'retail',
      moduleLabel: { ja: '小売パック', en: 'Retail pack' },
      pack: 'retail',
      applied: false,
      mutates: true,
      permission: { kind: 'roles', roles: ['sales'] },
      storeAccess: true,
      siteAccess: false,
      relayAccess: false,
      runnable: ['admin', 'sales'],
    },
  ],
  packs: [{ name: 'retail', label: { ja: '小売', en: 'Retail' }, applied: false }],
  kernel: [
    {
      id: 'company_settings',
      label: { ja: '会社設定', en: 'Company settings' },
      roles: ['admin', 'settings'],
      companyWide: true,
      tenantAdmin: false,
    },
  ],
};

describe('permission matrix screen (access-insight AC-6)', () => {
  it('AC-6: the URL search round-trips; unknown or malformed values are dropped', () => {
    const search = parsePermissionsSearch({ tab: 'actions', module: 'sales', role: 'sales', q: '取引', packs: 'all' });
    expect(search).toEqual({ tab: 'actions', module: 'sales', role: 'sales', q: '取引', packs: 'all' });
    expect(parsePermissionsSearch(permissionsSearchParams(search))).toEqual(search);
    expect(parsePermissionsSearch({ tab: 'other', module: 'Bad Name', role: 1, q: '', packs: 'yes' })).toEqual({
      tab: 'data',
    });
    expect(permissionsSearchParams({ tab: 'data' })).toEqual({});
  });

  it('AC-6: unapplied packs are hidden unless shown; module and name filters (ja/en label or name)', () => {
    expect(filterEntities(matrix, { tab: 'data' }).map((e) => e.name)).toEqual(['partner', 'payment']);
    expect(filterEntities(matrix, { tab: 'data', packs: 'all' }).map((e) => e.name)).toEqual([
      'partner',
      'payment',
      'crate',
    ]);
    expect(filterEntities(matrix, { tab: 'data', module: 'partner' }).map((e) => e.name)).toEqual(['partner']);
    expect(filterEntities(matrix, { tab: 'data', q: '取引' }).map((e) => e.name)).toEqual(['partner']);
    expect(filterEntities(matrix, { tab: 'data', q: 'PAYMENT' }).map((e) => e.name)).toEqual(['payment']);
    expect(filterActions(matrix, { tab: 'actions' }).map((a) => a.name)).toEqual(['sales.confirm_order']);
    expect(filterActions(matrix, { tab: 'actions', packs: 'all', q: 'register' }).map((a) => a.name)).toEqual([
      'retail.close_register',
    ]);
    expect(moduleOptions(matrix, false).map((m) => m.name)).toEqual(['partner', 'sales']);
    expect(moduleOptions(matrix, true).map((m) => m.name)).toEqual(['partner', 'sales', 'retail']);
    expect(groupByModule(matrix.entities).map((g) => [g.module, g.items.length])).toEqual([
      ['partner', 1],
      ['sales', 1],
      ['retail', 1],
    ]);
  });

  it('AC-6: cells show abbreviations with a legend and full names for assistive technology', () => {
    expect(cellText(['read', 'create', 'export'], 'ja')).toEqual({ abbr: '閲作出', full: '閲覧、作成、CSV 出力' });
    expect(cellText(['read', 'create', 'export'], 'en')).toEqual({ abbr: 'R C E', full: 'Read, Create, Export' });
    expect(cellText([], 'ja')).toEqual({ abbr: '—', full: '権限なし' });
    const abbrs = Object.values(OP_TEXT).map((t) => t.abbr.ja);
    expect(new Set(abbrs).size).toBe(abbrs.length);
  });

  it('AC-6: badges for own rows, conditions, fields, store/site limits, relay, no audit, unapplied packs, tenant data', () => {
    const [partner, payment, crate] = matrix.entities as [MatrixEntity, MatrixEntity, MatrixEntity];
    expect(entityBadges(partner)).toEqual(['self']);
    expect(entityBadges(partner, 'settings')).toEqual([]);
    expect(entityBadges(payment)).toEqual(['conditional', 'fields', 'stores']);
    expect(entityBadges(crate)).toEqual(['relay', 'noAudit', 'unapplied', 'tenant']);
    expect(BADGE_TEXT.noAudit.label.ja).toContain('CSV 出力は記録');
    expect(submitNote(payment)).toEqual({ ja: 'approve 経由のみ', en: 'only via approve' });
    expect(submitNote({ ...payment, submitVia: ['a', 'b'] })?.en).toContain('plain submit refused');
    expect(submitNote(partner)).toBeNull();
  });

  it('AC-6: action entry permissions and kernel capabilities of a role column', () => {
    expect(permissionText((matrix.actions[0] as PermissionMatrix['actions'][number]).permission, matrix.roles)).toEqual(
      {
        ja: '受注の確定',
        en: 'Submit on Sales order',
      },
    );
    expect(permissionText({ kind: 'roles', roles: ['sales', 'x'] }, matrix.roles)).toEqual({
      ja: 'ロール: 営業、x',
      en: 'Roles: Sales, x',
    });
    expect(permissionText({ kind: 'authenticated' }, matrix.roles).ja).toBe('ログインした利用者');
    expect(kernelCapabilitiesOf(matrix, 'settings').map((c) => c.id)).toEqual(['company_settings']);
    expect(kernelCapabilitiesOf(matrix, 'sales')).toEqual([]);
    expect(policyText(null).ja).toContain('使えない');
    expect(
      policyText({ kind: 'parent', field: 'itemId', entity: 'item', entityLabel: { ja: '品目', en: 'Item' } }).en,
    ).toBe('Rows under a visible Item (itemId)');
  });
});

describe('permission matrix narrow screens (access-insight AC-7)', () => {
  it('AC-7: the role in the URL wins; a narrow screen defaults to the first role after admin; wide shows all', () => {
    expect(viewRole({ tab: 'data' }, matrix.roles, false)).toBeUndefined();
    expect(viewRole({ tab: 'data' }, matrix.roles, true)).toBe('sales');
    expect(viewRole({ tab: 'data', role: 'settings' }, matrix.roles, true)).toBe('settings');
    expect(viewRole({ tab: 'data', role: 'unknown' }, matrix.roles, false)).toBeUndefined();
  });
});
