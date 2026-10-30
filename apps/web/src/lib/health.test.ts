// docs/specs/setup-health.md AC-8..AC-10 (pure parts of /admin/health): fail, warn, ok order; status as tone and text;
// the summary; in-app links only; the navigation entry is for admin or settings in the settings workspace.
import { describe, expect, it } from 'vitest';
import { DEDICATED_NAVIGATION } from './navigation-data.ts';
import {
  healthCounts,
  healthLink,
  linkText,
  sortHealthItems,
  STATUS_TEXT,
  STATUS_TONE,
  summaryText,
  type HealthItem,
} from './health.ts';

const item = (id: string, status: HealthItem['status']): HealthItem => ({
  id,
  status,
  label: { ja: id, en: id },
  detail: { ja: '詳細', en: 'Detail' },
});

describe('setup-health AC-9: order, status and summary', () => {
  it('AC-9: fail, then warn, then ok, keeping the API order inside a status', () => {
    const items = [item('a', 'ok'), item('b', 'warn'), item('c', 'fail'), item('d', 'ok'), item('e', 'fail')];
    expect(sortHealthItems(items).map((i) => i.id)).toEqual(['c', 'e', 'b', 'a', 'd']);
    expect(healthCounts(items)).toEqual({ fail: 2, warn: 1, ok: 2 });
  });

  it('AC-9: each status has a colour tone and a word in ja and en', () => {
    expect(STATUS_TONE).toEqual({ fail: 'danger', warn: 'warning', ok: 'success' });
    for (const status of ['fail', 'warn', 'ok'] as const) {
      expect(STATUS_TEXT[status].ja).not.toBe('');
      expect(STATUS_TEXT[status].en).not.toBe('');
    }
    expect(linkText('fail')).toEqual({ ja: '直す', en: 'Fix' });
    expect(linkText('ok')).toEqual({ ja: '確認する', en: 'Review' });
  });

  it('AC-9: the summary counts each status, or says everything is OK', () => {
    expect(summaryText([item('a', 'ok'), item('b', 'ok')])).toEqual({
      ja: '2 項目すべて OK です。',
      en: 'All 2 items are OK.',
    });
    expect(summaryText([item('a', 'fail'), item('b', 'warn'), item('c', 'ok')]).ja).toBe(
      '要対応 1 件・注意 1 件・OK 1 件',
    );
  });
});

describe('setup-health AC-8/AC-10: links and navigation', () => {
  it('AC-8: router targets for in-app paths; nothing for anything else', () => {
    expect(healthLink('/settings?tab=company')).toEqual({ to: '/settings', search: { tab: 'company' } });
    expect(healthLink('/a/accounting.open_fiscal_year')).toEqual({ to: '/a/accounting.open_fiscal_year', search: {} });
    for (const bad of [undefined, '', 'https://x.example', '//x.example', '/a/../b', 'javascript:alert(1)'])
      expect(healthLink(bad), String(bad)).toBeUndefined();
  });

  it('AC-10: the screen is a settings-role entry of the settings and administration workspace', () => {
    expect(DEDICATED_NAVIGATION.find((n) => n.href === '/admin/health')).toMatchObject({
      workspace: 'admin',
      condition: 'settings',
    });
  });
});
