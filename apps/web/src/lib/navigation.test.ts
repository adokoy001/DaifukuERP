import { describe, expect, it } from 'vitest';
import type { ActionMeta, AppMeta, EntityMeta, Label, MenuItem, ModuleMeta } from '../api/types.ts';
import {
  buildNavigation,
  findNavigationEntry,
  findNavigationWorkspace,
  searchNavigation,
  workspaceForModule,
} from './navigation.ts';

const label = (ja: string, en = ja): Label => ({ ja, en });
function entity(name: string, module: string | undefined = 'sales', extra: Partial<EntityMeta> = {}): EntityMeta {
  return {
    name,
    module,
    kind: 'entity',
    label: label(name),
    scope: 'company',
    displayField: undefined,
    hasExt: false,
    fields: [],
    views: { list: [], form: 'auto', search: [] },
    ops: ['read'],
    ...extra,
  };
}
function action(name: string, kind: ActionMeta['resultKind'] = 'other', extra: Partial<ActionMeta> = {}): ActionMeta {
  return {
    name,
    module: name.split('.')[0] ?? 'unknown',
    description: label(`${name}を表示します。`, `Display ${name}.`),
    generic: false,
    mutates: false,
    resultKind: kind,
    ...extra,
  };
}
function meta(
  entities: EntityMeta[] = [],
  actions: ActionMeta[] = [],
  modules: ModuleMeta[] = [],
  roles = ['viewer'],
): AppMeta {
  return { entities, actions, modules, roles };
}
const hrefs = (value: AppMeta | undefined, tenantAdmin = false) =>
  buildNavigation(value, tenantAdmin).entries.map((entry) => entry.href);

describe('authorized navigation catalog', () => {
  it('does not reuse a prior company catalog while metadata is unavailable', () => {
    expect(buildNavigation(undefined, true)).toEqual({ entries: [], workspaces: [] });
    const empty = buildNavigation(meta(), false);
    expect(empty.entries.map((entry) => entry.href)).toEqual(['/analytics', '/templates', '/account']);
    expect(empty.workspaces.map((workspace) => workspace.id)).toEqual(['reports', 'admin']);
    expect(empty.entries.some((entry) => entry.href === '/reports')).toBe(false);
  });
  it('gates each dedicated screen with its entry action and preserves route ownership', () => {
    const routes = [
      ['workforce.my_portal', '/me', 'workforce'],
      ['workforce.management_portal', '/workforce', 'workforce'],
      ['workforce.shift_board', '/workforce/shifts', 'workforce'],
      ['workforce.fiscal_board', '/workforce/payroll', 'workforce'],
      ['workforce.work_system_board', '/workforce/systems', 'workforce'],
      ['trade.board', '/commerce/trade', 'sales'],
      ['banking.board', '/finance/banking', 'finance'],
      ['tax_filing.board', '/finance/filing', 'finance'],
      ['pos_integration.inbox', '/commerce/pos', 'operations'],
      ['group_accounting.companies', '/commerce/group', 'finance'],
      ['franchise.board', '/commerce/franchise', 'finance'],
      ['edge.board', '/operations/devices', 'operations'],
      ['restaurant_chain.operations_snapshot', '/operations', 'operations'],
    ] as const;
    for (const [name, href, workspace] of routes) {
      expect(hrefs(meta())).not.toContain(href);
      expect(findNavigationEntry(buildNavigation(meta([], [action(name)]), false), href)).toMatchObject({
        href,
        workspace,
        featured: true,
        kind: 'workspace',
      });
    }
  });
  it('keeps tenant administration separate from company settings permission', () => {
    expect(hrefs(meta([], [], [], ['admin']))).toContain('/settings');
    expect(hrefs(meta([], [], [], ['admin']))).not.toContain('/admin/users');
    expect(hrefs(meta([], [], [], ['settings']))).toContain('/settings');
    expect(hrefs(meta(), true)).toContain('/admin/users');
    expect(hrefs(meta(), true)).not.toContain('/settings');
  });
  it('includes every readable non-line entity and excludes declared child entities and unreadable records', () => {
    const data = meta([
      entity('invoice', 'sales', { kind: 'document', lines: [{ entity: 'details', parentField: 'invoiceId' }] }),
      entity('details'),
      entity('restricted', 'sales', { ops: ['create'] }),
      entity('shipping_line', 'logistics'),
    ]);
    expect(hrefs(data)).toEqual(expect.arrayContaining(['/e/invoice', '/e/shipping_line']));
    expect(hrefs(data)).not.toEqual(expect.arrayContaining(['/e/details']));
    expect(hrefs(data)).not.toContain('/e/restricted');
  });
  it('deduplicates dedicated/menu/entity/report URLs and retains menu aliases without mutating metadata', () => {
    const data = meta(
      [entity('partner', 'partner', { label: label('取引先', 'Partners') })],
      [action('banking.board'), action('accounting.trial_balance', 'table')],
      [
        {
          name: 'partner',
          label: label('取引先管理', 'Partner management'),
          menus: [
            { entity: 'partner', label: label('顧客', 'Customers'), order: 20 },
            { entity: 'partner', label: label('得意先一覧', 'Customer directory'), order: 10 },
            { route: '/e/partner', label: label('仕入先', 'Suppliers') },
          ],
        },
        {
          name: 'banking',
          label: label('銀行', 'Banking'),
          menus: [{ route: '/finance/banking', label: label('銀行明細・支払資料', 'Bank files') }],
        },
        {
          name: 'accounting',
          label: label('会計', 'Accounting'),
          menus: [{ route: '/r/accounting.trial_balance', label: label('試算表', 'Trial balance') }],
        },
      ],
    );
    const before = JSON.stringify(data);
    const catalog = buildNavigation(data, false);
    expect(new Set(catalog.entries.map((entry) => entry.href)).size).toBe(catalog.entries.length);
    expect(catalog.entries.filter((entry) => entry.href === '/e/partner')).toHaveLength(1);
    expect(findNavigationEntry(catalog, '/finance/banking')?.label.ja).toBe('銀行連携・消込');
    for (const term of ['取引先', '顧客', '得意先', '仕入先', 'Partner management'])
      expect(searchNavigation(catalog, term, 'ja').some((entry) => entry.href === '/e/partner')).toBe(true);
    expect(findNavigationEntry(catalog, '/r/accounting.trial_balance')).toMatchObject({
      workspace: 'reports',
      module: 'accounting',
      kind: 'report',
    });
    expect(JSON.stringify(data)).toBe(before);
  });
  it('uses canonical entity ownership even when another module supplies its menu label', () => {
    const catalog = buildNavigation(
      meta(
        [entity('workforce_payroll', 'workforce')],
        [],
        [{ name: 'accounting', label: label('会計'), menus: [{ entity: 'workforce_payroll', label: label('給与') }] }],
      ),
      false,
    );
    expect(findNavigationEntry(catalog, '/e/workforce_payroll')).toMatchObject({
      workspace: 'workforce',
      module: 'workforce',
    });
  });
  it('retains unknown modules, unclassified entities and their valid menu actions', () => {
    const catalog = buildNavigation(
      meta(
        [entity('future_job', 'future'), { ...entity('unclassified'), module: undefined }],
        [action('future.finish')],
        [
          {
            name: 'future',
            label: label('将来の業務', 'Future work'),
            menus: [{ route: '/a/future.finish', label: label('仕事を終える', 'Finish work') }],
          },
        ],
      ),
      false,
    );
    expect(
      catalog.workspaces.find((workspace) => workspace.id === 'other')?.entries.map((entry) => entry.href),
    ).toEqual(['/a/future.finish', '/e/future_job', '/e/unclassified']);
  });
  it('does not cap reachability when hundreds of new records and reports are registered', () => {
    const records = Array.from({ length: 700 }, (_, i) => entity(`extra_${i}`, 'future'));
    const reports = Array.from({ length: 300 }, (_, i) => action(`future.report_${i}`, 'table'));
    const catalog = buildNavigation(meta(records, reports), false);
    expect(catalog.entries.filter((entry) => entry.kind === 'record')).toHaveLength(700);
    expect(catalog.entries.filter((entry) => entry.kind === 'report')).toHaveLength(300);
    expect(searchNavigation(catalog, '/e/extra_', 'en')).toHaveLength(700);
    expect(catalog.entries.map((entry) => entry.href)).toContain('/reports');
  });
});

describe('safe menu route contract', () => {
  it('cannot use a menu declaration to bypass settings, dedicated-action or entity permissions', () => {
    const data = meta(
      [],
      [],
      [
        {
          name: 'future',
          label: label('新業務'),
          menus: [
            { route: '/admin/users', label: label('利用者') },
            { route: '/settings', label: label('設定') },
            { route: '/finance/banking', label: label('銀行') },
            { entity: 'secret', label: label('秘密') },
            { route: '/e/secret', label: label('秘密') },
            { route: '/r/secret.report', label: label('秘密') },
          ],
        },
      ],
    );
    expect(hrefs(data)).toEqual(['/analytics', '/templates', '/account']);
  });
  it('matches the generic action and table page visibility rules', () => {
    const actions = [
      action('future.run'),
      action('future.report', 'table'),
      action('future.generic', 'other', { generic: true }),
      action('pack.apply', 'record'),
    ];
    const menus = [
      '/a/future.run',
      '/r/future.run',
      '/a/future.report',
      '/r/future.report',
      '/a/future.generic',
      '/a/pack.apply',
    ].map((route) => ({ route, label: label(route) }));
    const paths = hrefs(meta([], actions, [{ name: 'future', label: label('追加業務'), menus }]));
    expect(paths).toEqual(expect.arrayContaining(['/a/future.run', '/r/future.report', '/reports']));
    for (const path of ['/r/future.run', '/a/future.report', '/a/future.generic', '/a/pack.apply'])
      expect(paths).not.toContain(path);
  });
  it('rejects external, encoded, ambiguous, query and unsupported paths', () => {
    const unsafe = [
      'https://example.com',
      '//example.com',
      'javascript:alert(1)',
      '/\\example.com',
      '/e/partner?companyId=other',
      '/e/partner#edit',
      '/e/%70artner',
      '/e/partner/../secret',
      '/e/partner/new',
      '/e/partner/',
      '/a/future.run?confirm=yes',
      '/r/future.report#download',
      '/operations/devices/jobs',
      '/login',
      '/auth/recovery-codes',
      '/unknown',
    ];
    const menus: MenuItem[] = unsafe.map((route) => ({ route, label: label(`Unsafe ${route}`) }));
    menus.push({ route: '/e/partner', entity: 'partner', label: label('Ambiguous target') });
    const catalog = buildNavigation(
      meta(
        [entity('partner'), entity('../escape')],
        [action('future.run'), action('future.report', 'table'), action('future.report?leak', 'table')],
        [{ name: 'future', label: label('新規'), menus }],
      ),
      false,
    );
    for (const path of unsafe) expect(catalog.entries.map((entry) => entry.href)).not.toContain(path);
    expect(
      catalog.entries.every(
        (entry) =>
          !entry.href.includes('?') &&
          !entry.href.includes('#') &&
          !entry.href.includes('%') &&
          !entry.href.includes('..'),
      ),
    ).toBe(true);
    expect(searchNavigation(catalog, 'Unsafe', 'en')).toEqual([]);
    expect(searchNavigation(catalog, 'Ambiguous target', 'en')).toEqual([]);
  });
});

describe('workspace classification and Japanese/English discovery', () => {
  it.each([
    ['partner', 'sales'],
    ['purchase', 'sales'],
    ['trade', 'sales'],
    ['real_estate', 'sales'],
    ['wholesale', 'sales'],
    ['professional_service', 'sales'],
    ['product', 'inventory'],
    ['inventory', 'inventory'],
    ['workforce', 'workforce'],
    ['workforce_evidence', 'workforce'],
    ['accounting', 'finance'],
    ['group_accounting', 'finance'],
    ['franchise', 'finance'],
    ['banking', 'finance'],
    ['tax_filing', 'finance'],
    ['l10n_jp', 'finance'],
    ['attachment', 'finance'],
    ['appliance_store', 'operations'],
    ['farm', 'operations'],
    ['restaurant_chain', 'operations'],
    ['retail', 'operations'],
    ['manufacturing', 'operations'],
    ['construction', 'operations'],
    ['logistics', 'operations'],
    ['hospitality', 'operations'],
    ['clinic', 'operations'],
    ['care_service', 'operations'],
    ['education', 'operations'],
    ['beauty_salon', 'operations'],
    ['pos_integration', 'operations'],
    ['edge', 'operations'],
    ['example', 'admin'],
    ['not_yet_created', 'other'],
    ['__proto__', 'other'],
    ['toString', 'other'],
  ])('classifies module %s as %s', (module, workspace) => {
    expect(workspaceForModule(module)).toBe(workspace);
  });
  it('folds width, kana, English case and whitespace while requiring every word', () => {
    const catalog = buildNavigation(
      meta(
        [entity('salary', 'workforce', { label: label('給与サポート', 'PAYROLL Support') })],
        [],
        [{ name: 'workforce', label: label('従業員・労務', 'People operations'), menus: [] }],
      ),
      false,
    );
    for (const term of ['給与 さぽーと', '給与　ｻﾎﾟｰﾄ', 'ｐａｙｒｏｌｌ SUPPORT', 'PEOPLE salary', '給与 /e/salary'])
      expect(searchNavigation(catalog, term, 'ja').map((entry) => entry.href)).toContain('/e/salary');
    expect(searchNavigation(catalog, '給与 不一致', 'ja')).toEqual([]);
    expect(searchNavigation(catalog, '給与', 'en').map((entry) => entry.href)).toContain('/e/salary');
  });
  it('prioritizes the displayed label and uses stable locale ordering for equal matches', () => {
    const catalog = buildNavigation(
      meta([
        entity('z_record', 'future', { label: label('対象2', 'Target 2') }),
        entity('a_record', 'future', { label: label('対象10', 'Target 10') }),
        entity('b_record', 'future', { label: label('対象2', 'Target 2') }),
      ]),
      false,
    );
    expect(searchNavigation(catalog, 'Target', 'en').map((entry) => entry.href)).toEqual([
      '/e/b_record',
      '/e/z_record',
      '/e/a_record',
    ]);
    expect(searchNavigation(catalog, '対象', 'ja').map((entry) => entry.href)).toEqual([
      '/e/b_record',
      '/e/z_record',
      '/e/a_record',
      '/analytics',
    ]);
    const copy = searchNavigation(catalog, '  ', 'ja');
    copy.pop();
    expect(catalog.entries).toHaveLength(6);
  });
});

describe('current location and exact route boundaries', () => {
  const catalog = buildNavigation(
    meta(
      [entity('partner', 'partner')],
      [action('workforce.fiscal_board'), action('accounting.trial_balance', 'table')],
    ),
    false,
  );
  it('maps authorized entity creation and UUID records to their list entry', () => {
    for (const path of ['/e/partner', '/e/partner/new', '/e/partner/01234567-89ab-7cde-8fab-0123456789ab']) {
      expect(findNavigationEntry(catalog, path)?.href).toBe('/e/partner');
      expect(findNavigationWorkspace(catalog, path)?.id).toBe('sales');
    }
    expect(findNavigationWorkspace(catalog, '/workforce/payroll')?.id).toBe('workforce');
    expect(findNavigationWorkspace(catalog, '/r/accounting.trial_balance')?.id).toBe('reports');
  });
  it('only resolves nonempty workspace routes and rejects prefix lookalikes', () => {
    expect(findNavigationWorkspace(catalog, '/workspaces/sales')?.id).toBe('sales');
    for (const path of [
      '/workspaces',
      '/workspaces/finance',
      '/workspaces/sales_extra',
      '/workspaces/sales/extra',
      '/workspaces/sales?x=1',
    ])
      expect(findNavigationWorkspace(catalog, path)).toBeUndefined();
    for (const path of [
      '/e/partner_extra',
      '/e/partner/not-a-uuid',
      '/e/partner/new/extra',
      '/e/partner/01234567-89ab-7cde-8fab-0123456789ab/delete',
      '/e/partner?x=1',
      '/e/%70artner/new',
      '/workforce/payroll-extra',
      '/workforce/payroll/extra',
      '/r/accounting.trial_balance?from=2026-01-01',
    ])
      expect(findNavigationEntry(catalog, path)).toBeUndefined();
  });
});
