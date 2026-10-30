// docs/specs/print-templates.md AC-5〜AC-9, AC-17, AC-25: the shared layout parts are pure, escape every string, print
// stored values unchanged, format dates by the company style, and build a complete document without active content.
import { COMPANY_PROFILE_KEY, registry } from '@daifuku/kernel';
import { describe, expect, it } from 'vitest';
import {
  addresseeBlock,
  amountBlock,
  dataTable,
  documentHeader,
  ensurePrintLayoutSettings,
  escapeHtml,
  formatDocumentDate,
  formatMoney,
  formatRate,
  issuerBlock,
  issuerFromCompanyProfile,
  lineTable,
  noteLine,
  partiesSection,
  printDocument,
  printTools,
  PRINT_DATE_STYLE_KEY,
  remarksSection,
  statusBanner,
  sumDecimals,
  taxBreakdownTable,
  totalsTable,
  withStatusBanner,
} from '../src/index.ts';

const EVIL = `<script>alert("x")</script>&'`;
const EVIL_ESCAPED = '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;';
const era = (d: string) => (d === '2026-10-30' ? '令和8年10月30日' : d === '2019-05-01' ? '令和元年5月1日' : 'X');

/** AC-6: no script, external resource or event attribute anywhere in a document. */
function assertInert(html: string): void {
  const tags = html.match(/<[^>]+>/g) ?? [];
  expect(tags.filter((tag) => /^<script|^<link|\ssrc=|\shref=|\son[a-z]+=/i.test(tag))).toEqual([]);
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/url\(/i);
}

describe('format (AC-5, AC-7, AC-8)', () => {
  it('AC-6 escapeHtml escapes & < > " \'', () => {
    expect(escapeHtml(EVIL)).toBe(EVIL_ESCAPED);
  });

  it('AC-7 money and rates: grouping / percent only, no rounding; sums are plain addition', () => {
    expect(formatMoney('1234567.5')).toBe('1,234,567.5');
    expect(formatMoney('-1000')).toBe('-1,000');
    expect(formatMoney('0.000001')).toBe('0.000001');
    expect(formatMoney('n/a')).toBe('n/a');
    expect(formatRate('0.1')).toBe('10%');
    expect(formatRate('0.08')).toBe('8%');
    expect(sumDecimals(['1000.5', '2000.25', 'x'])).toBe('3000.75');
    expect(sumDecimals([])).toBe('0');
  });

  it('AC-8 formatDocumentDate: western / japanese_era / both in ja and en', () => {
    expect(formatDocumentDate('2026-10-30', 'western', 'ja', era)).toBe('2026年10月30日');
    expect(formatDocumentDate('2026-10-30', 'western', 'en', era)).toBe('2026-10-30');
    expect(formatDocumentDate('2026-10-30', 'japanese_era', 'ja', era)).toBe('令和8年10月30日');
    expect(formatDocumentDate('2026-10-30', 'japanese_era', 'en', era)).toBe('令和8年10月30日');
    expect(formatDocumentDate('2026-10-30', 'both', 'ja', era)).toBe('2026年10月30日（令和8年10月30日）');
    expect(formatDocumentDate('2026-10-30', 'both', 'en', era)).toBe('2026-10-30（令和8年10月30日）');
    expect(formatDocumentDate('2026-01-05', 'western', 'ja')).toBe('2026年1月5日');
  });

  it('AC-8 without the era override, or when it cannot convert, dates are western', () => {
    expect(formatDocumentDate('2026-10-30', 'japanese_era', 'ja')).toBe('2026年10月30日');
    expect(formatDocumentDate('2026-10-30', 'both', 'en')).toBe('2026-10-30');
    const throwing = () => {
      throw new Error('no era');
    };
    expect(formatDocumentDate('1800-01-01', 'japanese_era', 'ja', throwing)).toBe('1800年1月1日');
    expect(formatDocumentDate('2026-10-30', 'both', 'ja', () => '')).toBe('2026年10月30日');
    expect(formatDocumentDate('not-a-date', 'both', 'ja', era)).toBe('not-a-date');
  });

  it('AC-8 printTools binds the locale and the date style', () => {
    const tools = printTools('en', 'japanese_era', era);
    expect(tools.date('2019-05-01')).toBe('令和元年5月1日');
    expect(tools.t({ ja: '見積書', en: 'Quotation' })).toBe('Quotation');
  });

  it('AC-8 the setting is declared once, on the company tab, with labels for each value', () => {
    ensurePrintLayoutSettings();
    ensurePrintLayoutSettings();
    const def = registry.setting(PRINT_DATE_STYLE_KEY);
    expect(def.category).toBe('company');
    expect(def.default).toBe('both');
    expect(Object.keys(def.valueLabels ?? {})).toEqual(['western', 'japanese_era', 'both']);
    for (const l of Object.values(def.valueLabels ?? {})) expect(l.ja && l.en).toBeTruthy();
  });
});

describe('issuer (AC-9)', () => {
  const profile = {
    legalName: '株式会社大福',
    invoiceRegistrationNo: 'T1234567890123',
    postalCode: '100-0001',
    address: '東京都千代田区1-1',
    phone: '03-0000-0000',
    email: 'info@example.com',
    representative: '代表 太郎',
  };

  it('AC-9 issuerFromCompanyProfile: legal name else company name; the payslip leaves the number out', () => {
    expect(issuerFromCompanyProfile({ name: '大福', settings: { [COMPANY_PROFILE_KEY]: profile } })).toEqual({
      name: '株式会社大福',
      invoiceRegistrationNo: 'T1234567890123',
      postalCode: '100-0001',
      address: '東京都千代田区1-1',
      phone: '03-0000-0000',
      email: 'info@example.com',
    });
    expect(issuerFromCompanyProfile({ name: '大福', settings: {} })).toEqual({ name: '大福' });
    expect(
      issuerFromCompanyProfile(
        { name: '大福', settings: { [COMPANY_PROFILE_KEY]: profile } },
        { registrationNo: false, email: false },
      ),
    ).toEqual({ name: '株式会社大福', postalCode: '100-0001', address: '東京都千代田区1-1', phone: '03-0000-0000' });
  });

  it('AC-9 issuerBlock prints the registration number unless asked not to; AC-6 escapes', () => {
    const issuer = { name: EVIL, invoiceRegistrationNo: 'T1234567890123', postalCode: '100-0001', address: 'A' };
    const html = issuerBlock(issuer, 'ja');
    expect(html).toContain('登録番号: T1234567890123');
    expect(html).toContain('〒100-0001 A');
    expect(html).toContain(EVIL_ESCAPED);
    expect(issuerBlock(issuer, 'ja', { registrationNo: false })).not.toContain('T1234567890123');
    expect(issuerBlock(issuer, 'en')).toContain('Registration no.: T1234567890123');
  });
});

describe('blocks (AC-5, AC-6, AC-7, AC-18, AC-25)', () => {
  it('AC-18 addresseeBlock: 御中 in Japanese only; a custom honorific (様)', () => {
    expect(addresseeBlock({ name: '得意先A', postalCode: '150-0001', address: '渋谷' }, 'ja')).toContain(
      '得意先A 御中',
    );
    expect(addresseeBlock({ name: '得意先A' }, 'en')).not.toContain('御中');
    expect(addresseeBlock({ name: '山田', lines: ['E001'] }, 'ja', { ja: ' 様', en: '' })).toContain('山田 様');
  });

  it('AC-5 lineTable marks reduced-rate lines with ※ and sits in a horizontally scrolling frame (AC-25)', () => {
    const html = lineTable(
      [
        {
          seq: 1,
          description: '商品A',
          quantity: '1000',
          uomCode: '個',
          unitPrice: '12.5',
          amount: '12500',
          taxLabel: '課税（標準） 10%',
          reduced: false,
        },
        {
          seq: 2,
          description: '食品C',
          quantity: '1',
          unitPrice: '100',
          amount: '100',
          taxLabel: '課税（軽減）',
          reduced: true,
        },
      ],
      'ja',
    );
    expect(html).toContain('>※食品C<');
    expect(html).not.toContain('※商品A');
    expect(html).toContain('>1,000 個<');
    expect(html).toContain('>12,500<');
    expect(html).toMatch(/<div class="table-wrap" style="overflow-x:auto;/);
  });

  it('AC-7 stored values print as stored, even when they do not match the rate (no recalculation)', () => {
    const html = taxBreakdownTable([{ label: '課税（標準） 10%', taxable: '1000', tax: '99', gross: '1099' }], 'ja', {
      total: { taxable: '1000', tax: '99', gross: '1099' },
    });
    expect(html).toContain('>99<');
    expect(html).toContain('>1,099<');
    expect(html).not.toContain('>100<');
    expect(html).toContain('<tfoot>');
    expect(totalsTable([{ label: '合計', value: '1099', strong: true }])).toContain('>1,099<');
  });

  it('AC-6 every part escapes its strings', () => {
    const parts = [
      addresseeBlock({ name: EVIL, address: EVIL, lines: [EVIL] }, 'ja'),
      documentHeader(EVIL, [[EVIL, EVIL]]),
      amountBlock(EVIL, '1', 'ja'),
      dataTable([{ label: EVIL }], [[EVIL]], { className: 'x', caption: EVIL, foot: [EVIL] }),
      remarksSection(EVIL, EVIL),
      noteLine(EVIL),
      lineTable(
        [{ seq: 1, description: EVIL, quantity: '1', unitPrice: '1', amount: '1', taxLabel: EVIL, reduced: false }],
        'ja',
      ),
    ];
    for (const html of parts) {
      expect(html).not.toContain('<script>');
      expect(html).toContain(EVIL_ESCAPED);
    }
  });

  it('AC-5 remarksSection is empty for empty text; amountBlock adds the unit per locale', () => {
    expect(remarksSection('備考', null)).toBe('');
    expect(remarksSection('備考', '  ')).toBe('');
    expect(amountBlock('御見積金額', '12345', 'ja')).toContain('12,345円');
    expect(amountBlock('Quotation total', '12345', 'en')).toContain('JPY 12,345');
  });

  it('AC-5 dataTable shows the empty text as one row', () => {
    expect(dataTable([{ label: 'a' }, { label: 'b' }], [], { className: 't', empty: 'なし' })).toContain(
      '<td colspan="2"',
    );
  });
});

describe('document and banners (AC-5, AC-6, AC-17, AC-25)', () => {
  const body = partiesSection(addresseeBlock({ name: EVIL }, 'ja'), issuerBlock({ name: '発行者' }, 'ja'));
  const doc = printDocument({ title: `見積書 ${EVIL}`, locale: 'ja', body, className: 'quotation' });

  it('AC-5 printDocument is a complete document: doctype, lang, title, viewport, A4 page box', () => {
    expect(doc.startsWith('<!DOCTYPE html>\n<html lang="ja">')).toBe(true);
    expect(doc).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(doc).toContain(`<title>見積書 ${EVIL_ESCAPED}</title>`);
    expect(doc).toContain('@page{size:A4;margin:12mm}');
    expect(doc).toContain('<article class="print-document quotation" lang="ja"');
    expect(doc.endsWith('</html>')).toBe(true);
  });

  it('AC-6 the document has no script, external resource or event attribute', () => {
    assertInert(doc);
    assertInert(lineTable([], 'ja'));
  });

  it('AC-17 statusBanner: draft, cancelled (the invoice markup), open period; bilingual role=status', () => {
    expect(statusBanner('draft')).toBe(
      '<p role="status" style="border:2px solid #b45309;padding:12px;color:#b45309;font-weight:bold">下書き（未確定） / DRAFT</p>',
    );
    expect(statusBanner('cancelled')).toBe(
      '<p role="status" style="border:2px solid #b91c1c;padding:12px;color:#b91c1c;font-weight:bold">取消済み / CANCELLED</p>',
    );
    expect(statusBanner('open_period')).toContain('締め前（期間途中） / Period not yet closed');
  });

  it('AC-17 withStatusBanner puts the banner right after <body>, else in front; no banner changes nothing', () => {
    const banner = statusBanner('draft');
    const out = withStatusBanner(doc, banner);
    expect(out.indexOf(banner)).toBe(out.indexOf('<body>') + '<body>'.length);
    expect(withStatusBanner('<p>fragment</p>', banner)).toBe(`${banner}<p>fragment</p>`);
    expect(withStatusBanner(doc, '')).toBe(doc);
    // the delivery note's draft banner (fulfillments never exist as drafts, so only the part is tested here)
    expect(withStatusBanner('<body class="delivery-note"><h1>納品書</h1></body>', banner)).toBe(
      `<body class="delivery-note">${banner}<h1>納品書</h1></body>`,
    );
  });
});
