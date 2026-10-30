// navigation-assist AC-6: route -> manual chapter. Every mapped chapter must exist under docs/manual/ and every
// section must be one of that chapter's level-2 headings, so a renamed chapter breaks this test, not the link.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEDICATED_NAVIGATION } from './navigation-data.ts';
import { DEFAULT_MANUAL_URL, helpTopicFor, helpUrl, manualBaseUrl } from './help.ts';

const MANUAL = fileURLToPath(new URL('../../../../docs/manual/', import.meta.url));
/** GitHub's heading anchor for the headings we link to (letters, digits, spaces -> hyphens). */
const anchor = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');

const ROUTES = [
  '/workspaces',
  '/workspaces/sales',
  '/analytics',
  '/reports',
  '/settings',
  '/templates',
  '/admin/users',
  '/admin/companies',
  '/admin/health',
  '/operations',
  '/operations/devices',
  '/me',
  '/workforce',
  '/workforce/shifts',
  '/workforce/payroll',
  '/workforce/systems',
  '/commerce/pos',
  '/commerce/group',
  '/commerce/franchise',
  '/commerce/trade',
  '/finance/banking',
  '/finance/filing',
  '/finance/recurring',
  '/finance/evidence',
  '/e/partner',
  '/e/partner/new',
  '/e/partner/00000000-0000-4000-8000-000000000001',
  '/e/product',
  '/e/warehouse',
  '/e/account',
  '/e/tax_rate',
  '/e/fiscal_year',
  '/e/sales_invoice',
  '/e/purchase_invoice',
  '/e/journal_entry',
  '/e/recurring_journal',
  '/e/recurring_journal_run',
  '/e/stock_entry',
  '/e/workforce_employee',
  '/e/real_estate_property',
  '/e/trade_order',
  '/e/restaurant_chain_store',
  '/e/edge_device',
  '/e/some_new_entity',
  '/r/accounting.trial_balance',
  '/r/accounting.general_ledger',
  '/r/accounting.tax_period_summary',
  '/r/sales.ar_aging',
  '/r/inventory.valuation',
  '/r/some_module.report',
  '/a/accounting.close_period',
  '/a/retail.close_register',
];

describe('navigation-assist AC-6: help for this screen', () => {
  it.each(ROUTES)('AC-6: %s maps to an existing manual chapter and section', (route) => {
    const topic = helpTopicFor(route);
    expect(topic).toBeDefined();
    if (!topic) return;
    const text = readFileSync(MANUAL + topic.chapter, 'utf8');
    if (topic.section) {
      const headings = [...text.matchAll(/^## (.+)$/gm)].map((match) => anchor(match[1] ?? ''));
      expect(headings).toContain(topic.section);
    }
  });

  it('AC-6: every dedicated screen in the navigation catalog has a chapter', () => {
    for (const screen of DEDICATED_NAVIGATION)
      if (screen.href !== '/account') expect(helpTopicFor(screen.href), screen.href).toBeDefined();
  });

  it('AC-6: specific chapters for masters, daily documents, reports and workforce', () => {
    expect(helpTopicFor('/e/partner')).toEqual({ chapter: '04-masters.md', section: '取引先' });
    expect(helpTopicFor('/e/sales_invoice/new')).toEqual({ chapter: '05-daily.md', section: '売上請求書を作る' });
    expect(helpTopicFor('/r/accounting.trial_balance')).toEqual({ chapter: '06-monthly.md', section: '試算表' });
    expect(helpTopicFor('/r/some_module.report')).toEqual({ chapter: 'appendix-m-analytics.md' });
    expect(helpTopicFor('/e/workforce_payroll')).toEqual({ chapter: 'appendix-f-workforce.md' });
    expect(helpTopicFor('/e/unknown_entity')).toEqual({ chapter: '02-basics.md' });
  });

  it('AC-6: screens without a chapter get no link', () => {
    for (const route of [
      '/',
      '/unknown',
      '/a/sales.record_payment',
      '/e/partner/not-a-uuid',
      '/e/Partner/../x',
      '/settings/extra',
      '/r/no-dot',
      '/workspaces/Sales',
      '/constructor',
      '/toString',
    ])
      expect(helpTopicFor(route), route).toBeUndefined();
  });

  it('AC-6: the link base is VITE_MANUAL_URL when it is an absolute http(s) URL, else the public repository', () => {
    expect(manualBaseUrl(undefined)).toBe(DEFAULT_MANUAL_URL);
    expect(manualBaseUrl('')).toBe(DEFAULT_MANUAL_URL);
    expect(manualBaseUrl('https://docs.example.com/daifuku/manual')).toBe('https://docs.example.com/daifuku/manual/');
    expect(manualBaseUrl('http://intranet.local/manual/')).toBe('http://intranet.local/manual/');
    for (const bad of [
      'javascript:alert(1)',
      '/docs/manual/',
      'docs/manual',
      'ftp://example.com/manual/',
      'https://example.com/manual/?ref=1',
      'https://example.com/manual/#top',
      'https://user:secret@example.com/manual/',
      42,
    ])
      expect(manualBaseUrl(bad)).toBe(DEFAULT_MANUAL_URL);
    expect(DEFAULT_MANUAL_URL).toBe('https://github.com/adokoy001/DaifukuERP/blob/main/docs/manual/');
  });

  it('AC-6: the URL is base + chapter + encoded section anchor', () => {
    expect(helpUrl({ chapter: '04-masters.md', section: '取引先' })).toBe(
      `${DEFAULT_MANUAL_URL}04-masters.md#${encodeURIComponent('取引先')}`,
    );
    expect(helpUrl({ chapter: '02-basics.md' }, 'https://docs.example.com/m/')).toBe(
      'https://docs.example.com/m/02-basics.md',
    );
  });
});
