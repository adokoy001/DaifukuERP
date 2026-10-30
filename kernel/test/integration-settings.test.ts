// docs/specs/event-delivery.md AC-6 (b)(e), AC-13 (stored URL forms), AC-15 (strict schema).
import { describe, expect, it } from 'vitest';
import {
  INTEGRATION_WEBHOOKS_SETTING,
  integrationWebhooksOf,
  integrationWebhooksSchema,
  topicMatches,
  webhookUrlProblem,
} from '../src/integration-settings.ts';
import { checkSettingDef } from '../src/setting-presentation.ts';

const endpoint = (patch: Record<string, unknown> = {}) => ({
  id: 'acct',
  label: '会計',
  url: 'https://hooks.example.com/daifuku',
  topics: ['sales_invoice.submitted'],
  ...patch,
});

describe('integration.webhooks setting', () => {
  it('AC-6 topicMatches: exact match or <prefix>.*', () => {
    expect(topicMatches('sales_invoice.submitted', 'sales_invoice.submitted')).toBe(true);
    expect(topicMatches('sales_invoice.*', 'sales_invoice.payment_applied')).toBe(true);
    expect(topicMatches('sales_invoice.*', 'sales_invoice_line.submitted')).toBe(false);
    expect(topicMatches('sales_invoice.*', 'sales_invoice.')).toBe(false);
    expect(topicMatches('sales_invoice.submitted', 'sales_invoice.cancelled')).toBe(false);
  });

  it('AC-13 stores https DNS hosts and loopback development URLs only', () => {
    for (const ok of [
      'https://hooks.example.com/daifuku',
      'https://hooks.example.com:8443/a?b=c',
      'https://example.co.jp.',
      'http://127.0.0.1:4000/hook',
      'https://localhost/hook',
      'http://[::1]:9000/',
    ])
      expect(webhookUrlProblem(ok), ok).toBeNull();
    for (const bad of [
      'http://hooks.example.com/',
      'https://user:pass@hooks.example.com/',
      'https://hooks.example.com/#x',
      'https://10.0.0.5/',
      'https://[2001:db8::1]/',
      'https://intranet/',
      'https://printer.local/',
      'https://api.internal/',
      'https://app.localhost/',
      'https://2130706434/',
      'ftp://127.0.0.1/',
      `https://hooks.example.com/${'a'.repeat(500)}`,
      'not a url',
    ])
      expect(webhookUrlProblem(bad), bad).not.toBeNull();
  });

  it('AC-15 strict schema: unknown keys, duplicate ids, 11 endpoints, bad topics and inbox topics are refused', () => {
    expect(integrationWebhooksSchema.safeParse({ endpoints: [endpoint()], inboxEmail: true }).success).toBe(true);
    expect(integrationWebhooksSchema.parse({ endpoints: [endpoint()], inboxEmail: false }).endpoints[0]?.enabled).toBe(
      true,
    );
    const refused = [
      { endpoints: [endpoint({ secret: 'whsec_x' })], inboxEmail: false },
      { endpoints: [], inboxEmail: false, secret: 'x' },
      { endpoints: [endpoint(), endpoint()], inboxEmail: false },
      { endpoints: Array.from({ length: 11 }, (_, i) => endpoint({ id: `e${i}` })), inboxEmail: false },
      { endpoints: [endpoint({ topics: ['Sales.submitted'] })], inboxEmail: false },
      { endpoints: [endpoint({ topics: ['*'] })], inboxEmail: false },
      { endpoints: [endpoint({ topics: [] })], inboxEmail: false },
      { endpoints: [endpoint({ topics: ['inbox.count_changed'] })], inboxEmail: false },
      { endpoints: [endpoint({ topics: ['inbox.*'] })], inboxEmail: false },
      { endpoints: [endpoint({ id: 'Bad Id' })], inboxEmail: false },
      { endpoints: [endpoint({ url: 'http://hooks.example.com/' })], inboxEmail: false },
      { endpoints: [endpoint({ label: '' })], inboxEmail: false },
    ];
    for (const value of refused)
      expect(integrationWebhooksSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
  });

  it('AC-15 the definition passes the B1 presentation check and invalid stored values read as the default', () => {
    expect(() => checkSettingDef(INTEGRATION_WEBHOOKS_SETTING)).not.toThrow();
    expect(INTEGRATION_WEBHOOKS_SETTING.category).toBe('integration');
    expect(Object.keys(INTEGRATION_WEBHOOKS_SETTING.fields ?? {})).toEqual(['endpoints', 'inboxEmail']);
    expect(integrationWebhooksOf({})).toEqual({ value: { endpoints: [], inboxEmail: false }, valid: true });
    expect(integrationWebhooksOf({ 'integration.webhooks': { endpoints: 'x' } })).toEqual({
      value: { endpoints: [], inboxEmail: false },
      valid: false,
    });
  });
});
