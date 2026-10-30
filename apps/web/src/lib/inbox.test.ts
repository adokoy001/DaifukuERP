// docs/specs/inbox.md AC-3..AC-6: provider selection from /meta, per-provider failure, href validation, home summary.
import { describe, expect, it } from 'vitest';
import type { ActionMeta, AppMeta, Label } from '../api/types.ts';
import {
  inboxGroups,
  inboxProviders,
  inboxSummary,
  inboxTarget,
  providerItems,
  replaceOutcome,
  type ProviderOutcome,
} from './inbox.ts';
import { buildNavigation, findNavigationEntry } from './navigation.ts';

const label = (ja: string, en = ja): Label => ({ ja, en });
function action(name: string, extra: Partial<ActionMeta> = {}): ActionMeta {
  return {
    name,
    module: name.split('.')[0] ?? '',
    description: label(`${name}の説明`, `${name} description`),
    generic: false,
    mutates: false,
    resultKind: 'other',
    ...extra,
  };
}
const meta: AppMeta = {
  entities: [],
  roles: ['workforce_manager', 'accounting'],
  modules: [
    { name: 'workforce', label: label('従業員・労務', 'Workforce'), menus: [] },
    { name: 'banking', label: label('銀行連携', 'Banking'), menus: [] },
  ],
  actions: [
    action('workforce.management_portal'),
    action('workforce.todo'),
    action('banking.board'),
    action('banking.todo'),
    action('edge.todo', { mutates: true }), // a mutating "todo" is not a provider
    action('sales_invoice.todo', { generic: true }),
    action('workforce.todo_list'),
    action('restaurant_chain.todo_extra'),
  ],
};
const catalog = buildNavigation(meta, false);
const item = (key: string, count: number, href: string, severity: 'info' | 'warn' = 'info') => ({
  key,
  label: label(key, key),
  count,
  href,
  severity,
});

describe('inbox providers (AC-3)', () => {
  it('AC-3: only runnable, read-only, non-generic <module>.todo actions from /meta are providers', () => {
    expect(inboxProviders(meta)).toEqual([
      { action: 'workforce.todo', module: 'workforce', label: label('従業員・労務', 'Workforce') },
      { action: 'banking.todo', module: 'banking', label: label('銀行連携', 'Banking') },
    ]);
    expect(inboxProviders(undefined)).toEqual([]);
    expect(inboxProviders({ ...meta, actions: meta.actions.filter((a) => !a.name.endsWith('.todo')) })).toEqual([]);
  });

  it('AC-8: the inbox screen is in the catalog only while at least one provider is runnable', () => {
    expect(findNavigationEntry(catalog, '/inbox')).toMatchObject({ href: '/inbox', workspace: 'other' });
    const without = buildNavigation({ ...meta, actions: [action('edge.todo', { mutates: true })] }, false);
    expect(findNavigationEntry(without, '/inbox')).toBeUndefined();
  });
});

describe('inbox hrefs (AC-6)', () => {
  it('AC-6: accepts catalog screens with an optional query and returns the path and search separately', () => {
    expect(inboxTarget('/workforce?period=2026-08&tab=payroll', catalog)).toEqual({
      pathname: '/workforce',
      search: { period: '2026-08', tab: 'payroll' },
    });
    expect(inboxTarget('/finance/banking', catalog)).toEqual({ pathname: '/finance/banking', search: {} });
  });

  it('AC-6: refuses external, protocol-relative, unknown, unauthorized and malformed hrefs', () => {
    for (const href of [
      'https://evil.example/workforce',
      '//evil.example/workforce',
      '/\\evil.example',
      'javascript:alert(1)',
      'workforce',
      '/workforce/../admin/users',
      '/admin/users', // a real route, but not in this caller's catalog
      '/unknown-screen',
      '/workforce#x',
      '/work force',
      42,
      undefined,
    ])
      expect(inboxTarget(href, catalog)).toBeUndefined();
  });

  it('AC-6: drops items with unknown hrefs or invalid shapes and counts them as dropped', () => {
    const result = providerItems(
      'workforce.todo',
      {
        items: [
          item('expense_review', 2, '/workforce?period=2026-09'),
          item('external', 1, 'https://evil.example/'),
          item('zero', 0, '/workforce'),
          item('fraction', 1.5, '/workforce'),
          { ...item('bad_severity', 1, '/workforce'), severity: 'error' },
          { ...item('no_label', 1, '/workforce'), label: { ja: '経費' } },
          item('expense_review', 9, '/workforce'), // duplicate key
          item('leave_review', 1, '/workforce', 'warn'),
        ],
      },
      catalog,
    );
    expect(result.items.map((entry) => [entry.id, entry.count, entry.severity])).toEqual([
      ['workforce.todo:expense_review', 2, 'info'],
      ['workforce.todo:leave_review', 1, 'warn'],
    ]);
    expect(result.dropped).toBe(6);
    expect(providerItems('workforce.todo', { rows: [] }, catalog)).toEqual({ items: [], dropped: 0 });
  });
});

describe('inbox groups and summary (AC-4/AC-5)', () => {
  const providers = inboxProviders(meta);
  const ok = (action: string, value: unknown): ProviderOutcome => ({ action, ok: true, value });

  it('AC-5: a failed provider becomes its own error group; the other provider still shows its items', () => {
    const error = new Error('HTTP 500');
    const groups = inboxGroups(
      providers,
      [
        ok('workforce.todo', { items: [item('expense_review', 3, '/workforce')] }),
        { action: 'banking.todo', ok: false, error },
      ],
      new Set(),
      catalog,
    );
    expect(groups.map((group) => [group.provider.action, group.status, group.total])).toEqual([
      ['workforce.todo', 'ok', 3],
      ['banking.todo', 'error', 0],
    ]);
    expect(groups[1]?.error).toBe(error);
    const summary = inboxSummary(groups);
    expect(summary).toMatchObject({ total: 3, loading: false });
    expect(summary.failed.map((provider) => provider.action)).toEqual(['banking.todo']);
  });

  it('AC-4: providers without a result or being retried are loading; a retry replaces only that outcome', () => {
    const first = [ok('workforce.todo', { items: [] }), { action: 'banking.todo', ok: false, error: 'x' } as const];
    expect(inboxGroups(providers, undefined, new Set(), catalog).map((group) => group.status)).toEqual([
      'loading',
      'loading',
    ]);
    expect(inboxGroups(providers, first, new Set(['banking.todo']), catalog).map((group) => group.status)).toEqual([
      'ok',
      'loading',
    ]);
    const retried = replaceOutcome(first, ok('banking.todo', { items: [item('unmatched', 4, '/finance/banking')] }));
    expect(inboxGroups(providers, retried, new Set(), catalog).map((group) => [group.status, group.total])).toEqual([
      ['ok', 0],
      ['ok', 4],
    ]);
    expect(inboxSummary(inboxGroups(providers, undefined, new Set(), catalog)).loading).toBe(true);
  });

  it('AC-4: the home summary totals every item and lists warnings first, then larger counts, up to the limit', () => {
    const groups = inboxGroups(
      providers,
      [
        ok('workforce.todo', {
          items: [
            item('a_info', 9, '/workforce'),
            item('b_warn', 1, '/workforce', 'warn'),
            item('c_info', 2, '/workforce'),
          ],
        }),
        ok('banking.todo', {
          items: [item('d_info', 9, '/finance/banking'), item('e_warn', 5, '/finance/banking', 'warn')],
        }),
      ],
      new Set(),
      catalog,
    );
    const summary = inboxSummary(groups, 4);
    expect(summary.total).toBe(26);
    expect(summary.top.map((entry) => entry.id)).toEqual([
      'banking.todo:e_warn',
      'workforce.todo:b_warn',
      'workforce.todo:a_info',
      'banking.todo:d_info',
    ]);
  });
});
