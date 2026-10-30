// Close guide screen helpers (docs/specs/close-guide.md AC-8..AC-13). Browser behaviour: e2e/close-guide.spec.ts.
import { describe, expect, it } from 'vitest';
import type { ActionMeta, AppMeta } from '../api/types.ts';
import {
  blockingSummary,
  closeState,
  countText,
  groupItems,
  itemScope,
  parseCloseSearch,
  periodOption,
  reportHref,
  splitHref,
  type CloseItem,
} from './close-guide.ts';
import { buildNavigation, findNavigationEntry } from './navigation.ts';
import { reportSearchValues } from './report.ts';
import type { SchemaField } from './schema.ts';

const draft = (entity: string, count: number, blocking: boolean): CloseItem => ({
  id: `draft:${entity}`,
  kind: 'draft',
  label: { ja: `${entity}の下書き`, en: `${entity} drafts` },
  count,
  blocking,
  href: `/e/${entity}`,
  entity,
  filter: { status: 'draft', field: 'date', from: '2026-09-01', to: '2026-09-30' },
});
const previous: CloseItem = {
  id: 'previous_period_open',
  kind: 'previous_period',
  label: { ja: '前の会計期間（2026-08）が締まっていない', en: 'Previous period (2026-08) is still open' },
  count: 1,
  blocking: false,
  href: '/finance/close?periodId=4d1c1d6e-3c0b-4a8e-9a55-0f0d6f6a1b2c',
};
const period = { id: 'p', code: '2026-09', startDate: '2026-09-01', endDate: '2026-09-30', isClosed: false };

describe('close guide: route search and links (AC-8, AC-9)', () => {
  it('AC-8 keeps only a well-formed period id in the route search', () => {
    expect(parseCloseSearch({ periodId: '4d1c1d6e-3c0b-4a8e-9a55-0f0d6f6a1b2c' })).toEqual({
      periodId: '4d1c1d6e-3c0b-4a8e-9a55-0f0d6f6a1b2c',
    });
    expect(parseCloseSearch({ periodId: 'x' })).toEqual({});
    expect(parseCloseSearch({ periodId: 12, other: 'y' })).toEqual({});
  });
  it('AC-8 report links carry the period dates; the report page reads only period date fields from the URL', () => {
    expect(
      reportHref({
        action: 'accounting.trial_balance',
        label: { ja: '試算表', en: 'Trial balance' },
        input: { from: '2026-09-01', to: '2026-09-30' },
      }),
    ).toBe('/r/accounting.trial_balance?from=2026-09-01&to=2026-09-30');
    const field = (name: string, kind: SchemaField['kind']): SchemaField => ({
      name,
      kind,
      label: { ja: name, en: name },
      required: false,
    });
    const fields = [field('from', 'date'), field('to', 'date'), field('asOf', 'date'), field('accountId', 'ref')];
    expect(
      reportSearchValues(fields, { from: '2026-09-01', to: '2026-02-30', asOf: 20260930, accountId: 'x', extra: 'y' }),
    ).toEqual({ from: '2026-09-01' });
    expect(reportSearchValues(fields, { asOf: '2026-09-30' })).toEqual({ asOf: '2026-09-30' });
  });
  it('AC-9 server hrefs become router path + search; draft items say which drafts the count covers', () => {
    expect(splitHref('/e/sales_invoice')).toEqual({ to: '/e/sales_invoice', search: {} });
    expect(splitHref(previous.href ?? '')).toEqual({
      to: '/finance/close',
      search: { periodId: '4d1c1d6e-3c0b-4a8e-9a55-0f0d6f6a1b2c' },
    });
    expect(itemScope(draft('sales_invoice', 1, true), 'ja')).toBe('2026-09-01〜2026-09-30の下書き');
    expect(itemScope(draft('sales_invoice', 1, true), 'en')).toBe('drafts dated 2026-09-01 to 2026-09-30');
    expect(itemScope(previous, 'ja')).toBeUndefined();
  });
});

describe('close guide: items and state (AC-10, AC-11, AC-13)', () => {
  const items = [
    draft('journal_entry', 2, true),
    draft('sales_invoice', 0, true),
    draft('stock_entry', 3, false),
    previous,
  ];
  it('AC-10 groups blocking work, warnings and clear items; the disabled reason names each blocking item', () => {
    const groups = groupItems(items);
    expect(groups.blocking.map((i) => i.id)).toEqual(['draft:journal_entry']);
    expect(groups.warnings.map((i) => i.id)).toEqual(['draft:stock_entry', 'previous_period_open']);
    expect(groups.clear.map((i) => i.id)).toEqual(['draft:sales_invoice']);
    expect(blockingSummary(items, 'ja')).toBe('締める前に次を確定または削除してください: journal_entryの下書き 2 件');
    expect(blockingSummary(items, 'en')).toBe('Submit or delete these before closing: journal_entry drafts (2)');
    expect(blockingSummary([previous], 'ja')).toBe('');
  });
  it('AC-10 AC-11 the state is closed, ready or blocked', () => {
    expect(closeState({ period, ready: true })).toBe('ready');
    expect(closeState({ period, ready: false })).toBe('blocked');
    expect(closeState({ period: { ...period, isClosed: true }, ready: false })).toBe('closed');
  });
  it('AC-13 texts exist in Japanese and English', () => {
    expect(periodOption(period, 'ja')).toBe('2026-09（2026-09-01〜2026-09-30）');
    expect(periodOption({ ...period, isClosed: true }, 'en')).toBe('2026-09 (2026-09-01 to 2026-09-30, closed)');
    expect(countText(1234, 'ja')).toBe('1,234 件');
    expect(countText(1234, 'en')).toBe('1,234');
  });
});

describe('close guide: navigation (AC-12)', () => {
  const action = (name: string): ActionMeta => ({
    name,
    module: name.split('.')[0] ?? '',
    description: { ja: name, en: name },
    generic: false,
    mutates: false,
    resultKind: 'other',
  });
  const meta = (actions: ActionMeta[]): AppMeta => ({ entities: [], actions, modules: [], roles: ['accounting'] });
  it('AC-12 is a finance dedicated screen only for callers of accounting.close_readiness', () => {
    expect(findNavigationEntry(buildNavigation(meta([]), false), '/finance/close')).toBeUndefined();
    expect(
      findNavigationEntry(buildNavigation(meta([action('accounting.close_readiness')]), false), '/finance/close'),
    ).toMatchObject({
      href: '/finance/close',
      workspace: 'finance',
      kind: 'workspace',
      featured: true,
      label: { ja: '月次締め', en: 'Month-end close' },
    });
    const finance = buildNavigation(meta([action('accounting.close_readiness')]), false).workspaces.find(
      (w) => w.id === 'finance',
    );
    expect(finance?.entries.map((entry) => entry.href)).toContain('/finance/close');
  });
});
