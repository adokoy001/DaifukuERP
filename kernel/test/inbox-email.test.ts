// docs/specs/event-delivery.md AC-17: the inbox mail text.
import { describe, expect, it } from 'vitest';
import { inboxEmailMessage } from '../src/inbox-watch.ts';

describe('inbox mail message', () => {
  it('AC-17 Japanese then English, totals, item labels and counts, inbox link and how to stop; nothing else', () => {
    const message = inboxEmailMessage({
      companyName: 'テスト株式会社',
      webUrl: 'https://erp.example.com/',
      payload: {
        userId: '0190d0a8-0000-7000-8000-000000000001',
        total: 5,
        previousTotal: 3,
        items: [
          {
            provider: 'workforce.todo',
            key: 'expense_approval',
            label: { ja: '経費の承認待ち', en: 'Expenses to approve' },
            count: 4,
            severity: 'warn',
            href: '/secret?x=1',
          },
          {
            provider: 'sales.todo',
            key: 'drafts',
            label: { ja: '下書きの請求書', en: 'Draft invoices' },
            count: 1,
            severity: 'info',
            partner: '取引先名',
          },
        ],
      },
    });
    expect(message.subject).toContain('5');
    expect(message.subject.indexOf('受信箱')).toBeLessThan(message.subject.indexOf('inbox'));
    const ja = message.text.indexOf('テスト株式会社 の受信箱');
    const en = message.text.indexOf('Your to-dos in テスト株式会社');
    expect(ja).toBeGreaterThanOrEqual(0);
    expect(en).toBeGreaterThan(ja);
    for (const fragment of [
      '3 件から 5 件',
      '経費の承認待ち: 4 件',
      'Draft invoices: 1',
      'https://erp.example.com/inbox',
      '表示されない項目',
      'オフ',
      'turn off',
    ])
      expect(message.text).toContain(fragment);
    expect(message.text).not.toContain('/secret');
    expect(message.text).not.toContain('取引先名');
    expect(message.text).not.toContain('0190d0a8');
    expect(message.text).not.toContain('workforce.todo');
  });
});
