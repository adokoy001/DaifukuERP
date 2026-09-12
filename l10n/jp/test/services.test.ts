// Pure services of l10n/jp (docs/specs/l10n-jp.md AC-3, AC-4, AC-5, AC-7): no DB, no registry.
import { Decimal, ValidationError, toHalfwidthKana as kernelToHalfwidthKana } from '@daifuku/kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatDateJa, formatJpy, formatNumber, formatRatePercent, toHalfwidthKana, toWareki, toWarekiParts, type Era } from '../src/index.ts';
import { escapeHtml, parseInvoiceRenderData, renderInvoiceHtml } from '../src/services/invoice-html.ts';
import type { InvoiceRenderData } from '../src/services/invoice-render-data.ts';
import { EXEMPT_SUPPLIER_CREDIT_RATIOS, exemptSupplierCreditRatio, transitionalCreditRatio } from '../src/services/transitional-credit.ts';

/** Matches a kernel ValidationError whose first issue is on `path`. */
const validationOn = (path: string) => expect.objectContaining({ code: 'VALIDATION', details: { issues: [expect.objectContaining({ path })] } });

// ---- AC-3 経過措置 ---------------------------------------------------------------------------------

describe('AC-3 exempt-supplier credit ratio (経過措置, 国税庁 令和8年度税制改正特集)', () => {
  const ratioAt = (date: string) => exemptSupplierCreditRatio({ supplierTaxStatus: 'exempt', date }).toString();

  it('AC-3 returns the statutory ratio at every boundary date', () => {
    const boundaries: [string, string][] = [
      ['2019-10-01', '1'],
      ['2023-09-30', '1'],
      ['2023-10-01', '0.8'],
      ['2026-09-30', '0.8'],
      ['2026-10-01', '0.7'],
      ['2028-09-30', '0.7'],
      ['2028-10-01', '0.5'],
      ['2030-09-30', '0.5'],
      ['2030-10-01', '0.3'],
      ['2031-09-30', '0.3'],
      ['2031-10-01', '0'],
      ['2040-01-01', '0'],
    ];
    for (const [date, expected] of boundaries) expect(ratioAt(date), date).toBe(expected);
  });

  it('AC-3 mid-period samples match the spec (purchase.md AC-7: 2026-10-15 → 0.7, 2026-09-15 → 0.8)', () => {
    expect(ratioAt('2026-10-15')).toBe('0.7');
    expect(ratioAt('2026-09-15')).toBe('0.8');
    expect(ratioAt('2029-04-01')).toBe('0.5');
    expect(ratioAt('2031-01-01')).toBe('0.3');
  });

  it('AC-3 registered suppliers always get 1 regardless of date', () => {
    for (const date of ['2020-01-01', '2026-09-30', '2026-10-01', '2031-10-01', '2050-12-31']) {
      const r = exemptSupplierCreditRatio({ supplierTaxStatus: 'registered', date });
      expect(r).toBeInstanceOf(Decimal);
      expect(r.toString(), date).toBe('1');
    }
  });

  it('AC-3 result is a kernel Decimal (never a JS number) and invalid input is VALIDATION', () => {
    expect(exemptSupplierCreditRatio({ supplierTaxStatus: 'exempt', date: '2026-10-01' })).toBeInstanceOf(Decimal);
    expect(() => exemptSupplierCreditRatio({ supplierTaxStatus: 'exempt', date: '2026-13-01' })).toThrow(ValidationError);
    expect(() => exemptSupplierCreditRatio({ supplierTaxStatus: 'exempt', date: '2026/10/01' })).toThrow(validationOn('date'));
    expect(() => exemptSupplierCreditRatio({ supplierTaxStatus: 'unknown' as 'exempt', date: '2026-10-01' })).toThrow(validationOn('supplierTaxStatus'));
  });

  it('AC-3 the table is contiguous (each row starts the day after the previous ends), ordered, and covers every date', () => {
    const table = EXEMPT_SUPPLIER_CREDIT_RATIOS;
    expect(table[0]?.validFrom).toBeNull();
    expect(table[table.length - 1]?.validTo).toBeNull();
    for (let i = 1; i < table.length; i++) {
      const prevEnd = table[i - 1]?.validTo ?? '';
      const next = new Date(`${prevEnd}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      expect(table[i]?.validFrom, `row ${i}`).toBe(next.toISOString().slice(0, 10));
      expect(Decimal.from(table[i]?.ratio ?? '').lte(table[i - 1]?.ratio ?? '')).toBe(true); // ratios only go down
    }
    fc.assert(
      fc.property(fc.date({ min: new Date('1990-01-01T00:00:00Z'), max: new Date('2099-12-31T00:00:00Z'), noInvalidDate: true }), (d) => {
        const r = transitionalCreditRatio(d.toISOString().slice(0, 10));
        return r.gte(0) && r.lte(1);
      }),
      { numRuns: 200 },
    );
  });

  it('AC-3 a custom table can be supplied (data change only, no code change when the law moves)', () => {
    const table = [
      { validFrom: null, validTo: '2031-09-30', ratio: '0.3', label: 'x' },
      { validFrom: '2031-10-01', validTo: '2033-09-30', ratio: '0.1', label: 'hypothetical extension' },
      { validFrom: '2033-10-01', validTo: null, ratio: '0', label: 'end' },
    ];
    expect(transitionalCreditRatio('2032-01-01', table).toString()).toBe('0.1');
    expect(() => transitionalCreditRatio('2032-01-01', table.slice(0, 1))).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });
});

// ---- AC-5 和暦 / 金額 --------------------------------------------------------------------------------

describe('AC-5 wareki', () => {
  it('AC-5 converts the spec example and every era boundary (元年 for year 1)', () => {
    const cases: [string, string][] = [
      ['2026-09-11', '令和8年9月11日'],
      ['2019-05-01', '令和元年5月1日'],
      ['2019-04-30', '平成31年4月30日'],
      ['1989-01-08', '平成元年1月8日'],
      ['1989-01-07', '昭和64年1月7日'],
      ['1926-12-25', '昭和元年12月25日'],
      ['1926-12-24', '大正15年12月24日'],
      ['1912-07-30', '大正元年7月30日'],
      ['1912-07-29', '明治45年7月29日'],
      ['1868-01-25', '明治元年1月25日'],
      ['2000-02-29', '平成12年2月29日'],
    ];
    for (const [date, expected] of cases) expect(toWareki(date), date).toBe(expected);
    expect(toWarekiParts('2026-09-11')).toEqual({ era: '令和', year: 8, month: 9, day: 11 });
  });

  it('AC-5 rejects dates before the era table and malformed dates with VALIDATION', () => {
    expect(() => toWareki('1868-01-24')).toThrow(validationOn('date'));
    expect(() => toWareki('2026-02-30')).toThrow(ValidationError);
    expect(() => toWareki('20260911')).toThrow(ValidationError);
  });

  it('AC-5 the era table is extensible: a new era added as data takes over from its start date', () => {
    const eras: Era[] = [{ name: '明治', start: '1868-01-25' }, { name: '令和', start: '2019-05-01' }, { name: '仮称', start: '2040-01-01' }];
    expect(toWareki('2039-12-31', eras)).toBe('令和21年12月31日');
    expect(toWareki('2040-01-01', eras)).toBe('仮称元年1月1日');
    expect(toWareki('2041-03-03', eras)).toBe('仮称2年3月3日');
  });

  it('AC-5 formatDateJa prints 西暦 without zero padding', () => {
    expect(formatDateJa('2026-09-01')).toBe('2026年9月1日');
    expect(() => formatDateJa('2026-9-1')).toThrow(ValidationError);
  });
});

describe('AC-5 formatJpy / formatNumber / formatRatePercent / toHalfwidthKana', () => {
  it('AC-5 formats yen with grouping and a leading ¥; negatives as -¥', () => {
    expect(formatJpy('3420')).toBe('¥3,420');
    expect(formatJpy(Decimal.from('3420'))).toBe('¥3,420');
    expect(formatJpy('0')).toBe('¥0');
    expect(formatJpy('999')).toBe('¥999');
    expect(formatJpy('1000')).toBe('¥1,000');
    expect(formatJpy('1234567890')).toBe('¥1,234,567,890');
    expect(formatJpy('-1000')).toBe('-¥1,000');
    expect(formatJpy('1234567.5')).toBe('¥1,234,567.5'); // never rounds silently
    expect(() => formatJpy('abc')).toThrow(ValidationError);
    expect(() => formatJpy(1.5)).toThrow(ValidationError);
  });

  it('AC-5 formatNumber groups digits and keeps the scale; property: digits are preserved', () => {
    expect(formatNumber('1234.5')).toBe('1,234.5');
    expect(formatNumber('-0.5')).toBe('-0.5');
    expect(formatNumber('0')).toBe('0');
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }), (n) => {
        const out = formatNumber(Decimal.from(n));
        return out.replace(/,/g, '') === n.toString() && !/^,|,,|,$/.test(out) && /^-?\d{1,3}(,\d{3})*$/.test(out);
      }),
    );
  });

  it('AC-5 formatRatePercent and the toHalfwidthKana re-export', () => {
    expect(formatRatePercent('0.10')).toBe('10%');
    expect(formatRatePercent('0.08')).toBe('8%');
    expect(formatRatePercent('0.075')).toBe('7.5%');
    expect(formatRatePercent('0')).toBe('0%');
    expect(toHalfwidthKana).toBe(kernelToHalfwidthKana);
    expect(toHalfwidthKana('ダイフク　ショウテン')).toBe('ﾀﾞｲﾌｸ ｼｮｳﾃﾝ');
  });
});

// ---- AC-4 適格請求書 HTML -------------------------------------------------------------------------

/** Fixed sample: the sales spec's golden numbers (AC-9: 10% 1,234 + 567 → 180; 8% 1,333 → 106; total 3,420). */
export const SAMPLE: InvoiceRenderData = {
  issuer: {
    name: '大福商店',
    invoiceRegistrationNo: 'T1234567890123',
    postalCode: '900-0001',
    address: '沖縄県那覇市港町1-2-3',
    phone: '098-000-0000',
    email: 'billing@example.com',
    bankInfo: '琉球銀行 本店 普通 1234567 ダイフクショウテン',
  },
  invoice: { number: 'INV-2026-0001', date: '2026-09-11', dueDate: '2026-10-31', note: 'お振込手数料は貴社にてご負担ください。', priceIncludesTax: false },
  recipient: { name: '株式会社テスト', postalCode: '100-0001', address: '東京都千代田区千代田1-1' },
  lines: [
    { seq: 1, description: '商品A', quantity: '1', unitPrice: '1234', amount: '1234', taxCategory: 'standard', rate: '0.10' },
    { seq: 2, description: 'サービスB <保守> & "特急"', quantity: '3', unitPrice: '189', amount: '567', taxCategory: 'standard', rate: '0.10' },
    { seq: 3, description: '食品C', quantity: '1', unitPrice: '1333', amount: '1333', taxCategory: 'reduced', rate: '0.08' },
  ],
  taxSummary: [
    { category: 'standard', rate: '0.10', taxable: '1801', tax: '180', gross: '1981' },
    { category: 'reduced', rate: '0.08', taxable: '1333', tax: '106', gross: '1439' },
  ],
  totals: { subtotal: '3134', taxTotal: '286', total: '3420' },
  locale: 'ja',
};

/** Every opening tag we emit has a matching close tag (a cheap well-formedness check without an HTML parser). */
function assertBalanced(html: string): void {
  for (const tag of ['html', 'head', 'body', 'article', 'section', 'div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'p', 'h1', 'h2', 'span', 'caption', 'style', 'title']) {
    const open = html.match(new RegExp(`<${tag}(\\s|>)`, 'g'))?.length ?? 0;
    const close = html.match(new RegExp(`</${tag}>`, 'g'))?.length ?? 0;
    expect(open, tag).toBe(close);
  }
}

describe('AC-4 適格請求書 HTML (sales.invoice_html override)', () => {
  const html = renderInvoiceHtml(SAMPLE);

  it('AC-7 golden: test/golden/invoice.html (update with `vitest -u` and record why in docs/log)', async () => {
    await expect(html).toMatchFileSnapshot('./golden/invoice.html');
  });

  it('AC-4 contains every 記載事項 of the qualified invoice in the Japanese layout', () => {
    expect(html.startsWith('<!DOCTYPE html>\n<html lang="ja">')).toBe(true);
    expect(html).toContain('<h1>請求書</h1>');
    expect(html).toContain('登録番号 T1234567890123');
    expect(html).toContain('株式会社テスト 御中');
    expect(html).toContain('大福商店');
    expect(html).toContain('<th scope="row">発行日</th><td>2026年9月11日（令和8年9月11日）</td>');
    expect(html).toContain('<th scope="row">支払期限</th><td>2026年10月31日（令和8年10月31日）</td>');
    expect(html).toContain('INV-2026-0001');
    // 明細: 品名・数量・単価・金額・税区分, ※ on the reduced-rate line only
    expect(html).toContain('<th>No.</th><th>品名</th><th>数量</th><th>単価</th><th>金額</th><th>税区分</th>');
    expect(html).toContain('<td>食品C※</td>');
    expect(html).toContain('<td>商品A</td>');
    expect(html).toContain('<td class="center">8%（軽減税率対象）</td>');
    expect(html).toContain('※印は軽減税率対象品目');
    // 税率ごとの合計: 税抜/消費税/税込 per rate, 8% marked 軽減税率対象
    expect(html).toContain('<caption>税率ごとの合計</caption>');
    expect(html).toContain('<th scope="row">10%対象</th><td class="num">¥1,801</td><td class="num">¥180</td><td class="num">¥1,981</td>');
    expect(html).toContain('<th scope="row">8%対象（軽減税率対象）</th><td class="num">¥1,333</td><td class="num">¥106</td><td class="num">¥1,439</td>');
    expect(html).toContain('<th scope="row">合計</th><td class="num">¥3,134</td><td class="num">¥286</td><td class="num">¥3,420</td>');
    expect(html).toContain('<span class="value">¥3,420</span>');
    expect(html).toContain('<h2>振込先</h2><p>琉球銀行 本店 普通 1234567 ダイフクショウテン</p>');
    expect(html).toContain('<h2>備考</h2><p>お振込手数料は貴社にてご負担ください。</p>');
    assertBalanced(html);
  });

  it('AC-4 is self-contained: inline CSS only, no external resources or scripts', () => {
    expect(html).toContain('<style>');
    expect(html).toContain('@page { size: A4;');
    expect(html).not.toMatch(/<link\s/);
    expect(html).not.toMatch(/<script/);
    expect(html).not.toMatch(/\bsrc=|\bhref=|url\(/);
  });

  it('AC-4 escapes every user-supplied string (XSS)', () => {
    expect(html).toContain('サービスB &lt;保守&gt; &amp; &quot;特急&quot;');
    const hostile = '<script>alert(1)</script><img src=x onerror=alert(1)>\'"';
    const evil: InvoiceRenderData = {
      ...SAMPLE,
      issuer: { ...SAMPLE.issuer, name: hostile, invoiceRegistrationNo: hostile, address: hostile, bankInfo: hostile },
      invoice: { ...SAMPLE.invoice, number: hostile, note: hostile },
      recipient: { name: hostile, address: hostile },
      lines: [{ ...SAMPLE.lines[0], description: hostile, taxCategory: hostile } as InvoiceRenderData['lines'][number]],
      taxSummary: [{ ...SAMPLE.taxSummary[0], category: hostile } as InvoiceRenderData['taxSummary'][number]],
    };
    const out = renderInvoiceHtml(evil);
    expect(out).not.toContain('<script>alert');
    expect(out).not.toContain('<img');
    // After removing the stylesheet and the fixed tags the template emits, no raw angle bracket may survive:
    // every '<' / '>' from the data must have been escaped.
    const stripped = out
      .replace(/<style>[\s\S]*?<\/style>/, '')
      .replace(/<\/?(!DOCTYPE html|html|head|meta|title|body|article|section|div|table|thead|tbody|tfoot|tr|th|td|p|h1|h2|span|caption)(\s[^<>]*)?>/g, '');
    expect(stripped).not.toMatch(/[<>]/);
    expect(out.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/g)?.length).toBe(10);
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    assertBalanced(out);
  });

  it('AC-4 omits empty optional parts, marks 税込 columns, and renders the en locale with the same 記載事項', () => {
    const minimal: InvoiceRenderData = {
      ...SAMPLE,
      issuer: { name: '個人事業主 山田太郎' },
      invoice: { ...SAMPLE.invoice, dueDate: null, note: null, priceIncludesTax: true },
      recipient: { name: '山田商店' },
      lines: [],
      taxSummary: [{ category: 'exempt', rate: '0', taxable: '0', tax: '0', gross: '0' }],
      totals: { subtotal: '0', taxTotal: '0', total: '0' },
    };
    const out = renderInvoiceHtml(minimal);
    expect(out).not.toContain('登録番号');
    expect(out).not.toContain('振込先');
    expect(out).not.toContain('備考');
    expect(out).toContain('<th scope="row">支払期限</th><td>—</td>');
    expect(out).toContain('<th>単価（税込）</th><th>金額（税込）</th>');
    expect(out).toContain('明細なし');
    expect(out).toContain('<th scope="row">免税</th>');
    assertBalanced(out);
    const en = renderInvoiceHtml({ ...SAMPLE, locale: 'en' });
    expect(en).toContain('<html lang="en">');
    expect(en).toContain('<h1>Invoice</h1>');
    expect(en).toContain('Registration No. T1234567890123');
    expect(en).toContain('<td>2026-09-11（令和8年9月11日）</td>');
    expect(en).toContain('<th scope="row">8%（reduced rate）</th>');
    expect(en).toContain('<p class="name">株式会社テスト</p>');
  });

  it('AC-4 rejects data that does not match the InvoiceRenderData contract with VALIDATION and paths', () => {
    const bad = { ...SAMPLE, totals: { subtotal: '3134', taxTotal: 'abc', total: '3420' }, invoice: { ...SAMPLE.invoice, date: '2026/09/11' } };
    expect(() => renderInvoiceHtml(bad as InvoiceRenderData)).toThrow(
      expect.objectContaining({ code: 'VALIDATION', details: { issues: expect.arrayContaining([{ path: 'invoice.date', message: 'must be YYYY-MM-DD' }, { path: 'totals.taxTotal', message: 'must be a decimal string' }]) } }),
    );
    expect(() => parseInvoiceRenderData(null)).toThrow(ValidationError);
    expect(() => parseInvoiceRenderData({})).toThrow(ValidationError);
    expect(parseInvoiceRenderData(SAMPLE).lines).toHaveLength(3);
  });
});
