// docs/specs/print-templates.md AC-6, AC-7, AC-15, AC-18, D-12: the default 合計請求書 layout (golden, Japanese), the
// closing-period arithmetic and the sums of stored tax summaries. Update the golden with `vitest -u` only for a
// deliberate layout change and record why in docs/log.
import { closingDateOf } from '@daifuku/mod-partner';
import { printTools } from '@daifuku/mod-print-layout';
import { describe, expect, it } from 'vitest';
import {
  assertStatementSize,
  isClosingDate,
  latestClosingDate,
  notClosingDateMessage,
  previousClosingDate,
  STATEMENT_MAX_INVOICES,
  statementPeriod,
  sumTaxSummaries,
} from '../src/actions/render-statement-html.ts';
import { defaultStatementHtml, type StatementRenderData } from '../src/services/statement-html.ts';

const era = (d: string) => `令和${Number(d.slice(0, 4)) - 2018}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const ja = printTools('ja', 'both', era);
const en = printTools('en', 'western');

const data: StatementRenderData = {
  issuer: {
    name: '大福商事株式会社',
    invoiceRegistrationNo: 'T1234567890123',
    postalCode: '100-0001',
    address: '東京都千代田区1-1',
    bankInfo: 'テスト銀行 本店 普通 1234567',
  },
  recipient: { name: '得意先A', postalCode: '150-0001', address: '東京都 渋谷区2-2' },
  statement: {
    closingDate: '2026-10-20',
    periodStart: '2026-09-21',
    issueDate: '2026-10-30',
    dueDate: '2026-11-30',
    openPeriod: false,
  },
  invoices: [
    {
      number: 'INV-2026-000001',
      date: '2026-09-25',
      dueDate: '2026-11-30',
      subtotal: '3134',
      taxTotal: '286',
      total: '3420',
    },
    {
      number: 'INV-2026-000002',
      date: '2026-10-20',
      dueDate: '2026-11-30',
      subtotal: '1000',
      taxTotal: '100',
      total: '1100',
    },
  ],
  taxSummary: [
    { category: 'standard', rate: '0.1', label: '課税（標準） 10%', taxable: '2801', tax: '280', gross: '3081' },
    { category: 'reduced', rate: '0.08', label: '課税（軽減） 8%', taxable: '1333', tax: '106', gross: '1439' },
  ],
  totals: { subtotal: '4134', taxTotal: '386', total: '4520' },
  locale: 'ja',
};

describe('statement layout (AC-15, D-12)', () => {
  it('AC-15 golden: test/golden/statement.html', async () => {
    await expect(defaultStatementHtml(data, ja)).toMatchFileSnapshot('./golden/statement.html');
  });

  it('AC-15 / D-12 the headline is the period total, never 「今回御請求額」, with the paid and summary notes', () => {
    const html = defaultStatementHtml(data, ja);
    for (const s of [
      '>合計請求書<',
      '当期ご請求額合計（税込）',
      '4,520円',
      '入金済みの請求書を含みます',
      '各請求書（適格請求書）の合計です',
      '2026年9月21日（令和8年9月21日） 〜 2026年10月20日（令和8年10月20日）',
      'お支払期限',
      '>INV-2026-000002<',
      '>3,420<',
      '>386<',
      '登録番号: T1234567890123',
      'テスト銀行 本店 普通 1234567',
      '得意先A 御中',
    ])
      expect(html).toContain(s);
    expect(html).not.toContain('今回御請求額');
    expect(html).not.toContain('※');
  });

  it('AC-15 no common due date -> no payment-due row; zero invoices -> the empty message and 0', () => {
    const html = defaultStatementHtml(
      {
        ...data,
        invoices: [],
        taxSummary: [],
        totals: { subtotal: '0', taxTotal: '0', total: '0' },
        statement: { ...data.statement, dueDate: null },
      },
      ja,
    );
    expect(html).toContain('この期間の確定済みの請求書はありません');
    expect(html).toContain('0円');
    expect(html).not.toContain('お支払期限');
    expect(html).not.toContain('税率ごとの合計');
  });

  it('AC-18 English labels', () => {
    const html = defaultStatementHtml({ ...data, locale: 'en' }, en);
    expect(html).toContain('Total of invoices this period');
    expect(html).toContain('Includes invoices already paid');
    expect(html).toContain('Summary of the listed qualified invoices');
    expect(html).not.toContain('御中');
  });

  it('AC-6 the partner name is escaped', () => {
    const html = defaultStatementHtml({ ...data, recipient: { name: '<b>A&B</b>' } }, ja);
    expect(html).toContain('&lt;b&gt;A&amp;B&lt;/b&gt;');
    expect(html).not.toContain('<b>A&B</b>');
  });
});

describe('closing periods (AC-15, D-8)', () => {
  it('AC-15 the previous closing date clamps to the month length (31 = month end, February)', () => {
    expect(previousClosingDate('2026-03-31', 31)).toBe('2026-02-28');
    expect(previousClosingDate('2026-03-30', 30)).toBe('2026-02-28');
    expect(previousClosingDate('2026-01-20', 20)).toBe('2025-12-20');
    expect(previousClosingDate('2028-03-31', 31)).toBe('2028-02-29');
  });

  it('AC-15 the period is (previous closing, closing]', () => {
    expect(statementPeriod('2026-10-20', 20)).toEqual({ start: '2026-09-21', end: '2026-10-20' });
    expect(statementPeriod('2026-02-28', 31)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(statementPeriod('2026-01-31', 31)).toEqual({ start: '2026-01-01', end: '2026-01-31' });
    expect(statementPeriod('2026-03-30', 30)).toEqual({ start: '2026-03-01', end: '2026-03-30' });
  });

  it('AC-15 the period is the same set as closingDateOf(date) === closingDate (every day of 2026, closing days 1..31)', () => {
    const days: string[] = [];
    for (let t = Date.UTC(2025, 11, 1); t <= Date.UTC(2027, 0, 31); t += 86_400_000)
      days.push(new Date(t).toISOString().slice(0, 10));
    for (let closingDay = 1; closingDay <= 31; closingDay++)
      for (const closing of new Set(
        days.filter((d) => d >= '2026-01-01' && d <= '2026-12-31').map((d) => closingDateOf(d, closingDay)),
      )) {
        if (closing > '2026-12-31') continue;
        const { start, end } = statementPeriod(closing, closingDay);
        const byRange = days.filter((d) => d >= start && d <= end);
        const byRule = days.filter((d) => closingDateOf(d, closingDay) === closing);
        expect(byRange, `${closingDay} ${closing}`).toEqual(byRule);
      }
  });

  it('AC-15 isClosingDate / latestClosingDate (D-8)', () => {
    expect(isClosingDate('2026-10-20', 20)).toBe(true);
    expect(isClosingDate('2026-10-21', 20)).toBe(false);
    expect(isClosingDate('2026-02-28', 31)).toBe(true);
    expect(isClosingDate('2026-02-28', 30)).toBe(true);
    expect(latestClosingDate('2026-10-30', 20)).toBe('2026-10-20');
    expect(latestClosingDate('2026-10-20', 20)).toBe('2026-10-20');
    expect(latestClosingDate('2026-10-19', 20)).toBe('2026-09-20');
    expect(latestClosingDate('2026-10-30', 31)).toBe('2026-09-30');
    expect(latestClosingDate('2026-10-31', 31)).toBe('2026-10-31');
  });
});

describe('statement limits and messages (AC-15, AC-25)', () => {
  it('AC-15 500 invoices in one period are printed; 501 are INVALID_STATE', () => {
    expect(STATEMENT_MAX_INVOICES).toBe(500);
    expect(() => assertStatementSize(0)).not.toThrow();
    expect(() => assertStatementSize(500)).not.toThrow();
    expect(() => assertStatementSize(501)).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE', message: expect.stringMatching(/501 .* at most 500/) }),
    );
    expect(() => assertStatementSize(3, 2)).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
  });

  it('AC-25 the message under 締め日 is in Japanese and English', () => {
    expect(notClosingDateMessage('2026-09-20', '2026-10-20')).toBe(
      '締め日ではありません（直近の締め日: 2026-09-20 または 2026-10-20） / not a closing date; nearest: 2026-09-20 or 2026-10-20',
    );
  });
});

describe('sumTaxSummaries (AC-7)', () => {
  it('AC-7 adds stored values by category and rate (no rounding), standard before reduced', () => {
    expect(
      sumTaxSummaries([
        [{ category: 'reduced', rate: '0.08', taxable: '1333', tax: '106', gross: '1439' }],
        [
          { category: 'standard', rate: '0.1', taxable: '1801', tax: '180', gross: '1981' },
          { category: 'reduced', rate: '0.08', taxable: '0.5', tax: '0.04', gross: '0.54' },
        ],
        [{ category: 'standard', rate: '0.1', taxable: '1000', tax: '99', gross: '1099' }],
      ]),
    ).toEqual([
      { category: 'standard', rate: '0.1', taxable: '2801', tax: '279', gross: '3080' },
      { category: 'reduced', rate: '0.08', taxable: '1333.5', tax: '106.04', gross: '1439.54' },
    ]);
  });
});
