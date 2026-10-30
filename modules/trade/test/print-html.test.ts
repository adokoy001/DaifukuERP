// docs/specs/print-templates.md AC-6, AC-7, AC-10〜AC-12, AC-18: golden HTML of the default 見積書・注文書・納品書 layouts
// (fixed render data, Japanese), plus English, escaping and "stored values as printed" checks. Update a golden with
// `vitest -u` only for a deliberate layout change and record why in docs/log.
import { printTools } from '@daifuku/mod-print-layout';
import { describe, expect, it } from 'vitest';
import {
  defaultDeliveryNoteHtml,
  defaultOrderHtml,
  defaultQuotationHtml,
  type DeliveryNoteRenderData,
  type TradeEstimateRenderData,
} from '../src/print-html.ts';

const era = (d: string) => `令和${Number(d.slice(0, 4)) - 2018}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const ja = printTools('ja', 'both', era);
const en = printTools('en', 'western', era);

const issuer = {
  name: '大福商事株式会社',
  invoiceRegistrationNo: 'T1234567890123',
  postalCode: '100-0001',
  address: '東京都千代田区1-1',
  phone: '03-0000-0000',
};

const estimate: TradeEstimateRenderData = {
  issuer,
  recipient: { name: '得意先A', postalCode: '150-0001', address: '東京都 渋谷区2-2' },
  document: {
    number: 'QT-2026-000001',
    date: '2026-10-01',
    docstatus: 1,
    validUntil: '2026-10-31',
    requiredDate: null,
    note: '納期は別途ご相談',
  },
  lines: [
    {
      seq: 1,
      description: '商品A',
      quantity: '10',
      uomCode: '個',
      unitPrice: '1200',
      amount: '12000',
      taxCategory: 'standard',
      taxLabel: '課税（標準） 10%',
    },
    {
      seq: 2,
      description: '食品C',
      quantity: '3',
      uomCode: 'kg',
      unitPrice: '500',
      amount: '1500',
      taxCategory: 'reduced',
      taxLabel: '課税（軽減） 8%',
    },
  ],
  taxSummary: [
    { category: 'standard', rate: '0.1', label: '課税（標準） 10%', taxable: '12000', tax: '1200', gross: '13200' },
    { category: 'reduced', rate: '0.08', label: '課税（軽減） 8%', taxable: '1500', tax: '120', gross: '1620' },
  ],
  totals: { subtotal: '13500', taxTotal: '1320', total: '14820' },
  locale: 'ja',
};

const order: TradeEstimateRenderData = {
  ...estimate,
  recipient: { name: '仕入先B', postalCode: '530-0001', address: '大阪府 大阪市北区3-3' },
  document: {
    number: 'ORD-2026-000002',
    date: '2026-10-05',
    docstatus: 1,
    validUntil: null,
    requiredDate: '2026-10-20',
    note: null,
  },
};

const delivery: DeliveryNoteRenderData = {
  issuer,
  recipient: estimate.recipient,
  document: { number: 'FUL-2026-000003', date: '2026-10-10', docstatus: 1, orderNumber: 'ORD-2026-000001', note: null },
  lines: [
    { ...(estimate.lines[0] as TradeEstimateRenderData['lines'][number]), taxLabel: '課税（標準）' },
    { ...(estimate.lines[1] as TradeEstimateRenderData['lines'][number]), taxLabel: '課税（軽減）' },
  ],
  categoryTotals: [
    { category: 'standard', label: '課税（標準）', amount: '12000' },
    { category: 'reduced', label: '課税（軽減）', amount: '1500' },
  ],
  total: '13500',
  locale: 'ja',
};

describe('trade print layouts: golden (AC-10〜AC-12)', () => {
  it('AC-10 golden: test/golden/quotation.html', async () => {
    await expect(defaultQuotationHtml(estimate, ja)).toMatchFileSnapshot('./golden/quotation.html');
  });
  it('AC-11 golden: test/golden/purchase-order.html', async () => {
    await expect(defaultOrderHtml(order, ja)).toMatchFileSnapshot('./golden/purchase-order.html');
  });
  it('AC-12 golden: test/golden/delivery-note.html', async () => {
    await expect(defaultDeliveryNoteHtml(delivery, ja)).toMatchFileSnapshot('./golden/delivery-note.html');
  });
});

describe('trade print layouts: content (AC-6, AC-7, AC-9, AC-10〜AC-12, AC-18)', () => {
  it('AC-10 the quotation has number, dates, addressee, issuer with registration no., total, lines with ※, breakdown, note', () => {
    const html = defaultQuotationHtml(estimate, ja);
    for (const s of [
      '>見積書<',
      'QT-2026-000001',
      '2026年10月1日（令和8年10月1日）',
      '有効期限',
      '得意先A 御中',
      '登録番号: T1234567890123',
      '御見積金額（税込）',
      '14,820円',
      '>※食品C<',
      '>課税（軽減） 8%<',
      '>1,320<',
      '※は軽減税率対象',
      '納期は別途ご相談',
    ])
      expect(html).toContain(s);
    expect(html).not.toContain('適格請求書');
  });

  it('AC-11 / AC-9 the purchase order shows the required date and leaves the buyer registration number out', () => {
    const html = defaultOrderHtml(order, ja);
    expect(html).toContain('>注文書<');
    expect(html).toContain('希望納期');
    expect(html).toContain('2026年10月20日（令和8年10月20日）');
    expect(html).toContain('仕入先B 御中');
    expect(html).not.toContain('T1234567890123');
    expect(html).not.toContain('有効期限');
  });

  it('AC-12 the delivery note has no tax amount, no rate %, per-category net totals and the invoice note', () => {
    const html = defaultDeliveryNoteHtml(delivery, ja);
    expect(html).toContain('>納品書<');
    expect(html).toContain('ORD-2026-000001');
    expect(html).toContain('>課税（軽減）<');
    expect(html).toContain('>13,500<');
    expect(html).toContain('消費税額は請求書に記載します');
    expect(html).toContain('>※食品C<');
    expect(html).not.toContain('消費税合計');
    expect(html.replace(/<[^>]+>/g, ' ')).not.toMatch(/\d+%/); // no rate in the text
  });

  it('AC-7 stored values are printed even when they do not match the rate (no recalculation)', () => {
    const odd = {
      ...estimate,
      taxSummary: [
        { category: 'standard', rate: '0.1', label: '課税（標準） 10%', taxable: '12000', tax: '1199', gross: '13199' },
      ],
      totals: { subtotal: '12000', taxTotal: '1199', total: '13199' },
    };
    const html = defaultQuotationHtml(odd, ja);
    expect(html).toContain('>1,199<');
    expect(html).toContain('13,199円');
    expect(html).not.toContain('13,200');
  });

  it('AC-18 English labels; no 御中; western dates under the western style', () => {
    const html = defaultQuotationHtml({ ...estimate, locale: 'en' }, en);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('>Quotation<');
    expect(html).toContain('2026-10-01');
    expect(html).not.toContain('令和');
    expect(html).not.toContain('御中');
    expect(html).toContain('Registration no.: T1234567890123');
    expect(defaultDeliveryNoteHtml({ ...delivery, locale: 'en' }, en)).toContain(
      'Consumption tax is stated on the invoice',
    );
  });

  it('AC-6 record strings are escaped; no script, external resource or event attribute', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = defaultQuotationHtml(
      {
        ...estimate,
        recipient: { name: evil },
        document: { ...estimate.document, note: evil },
        lines: [{ ...(estimate.lines[0] as TradeEstimateRenderData['lines'][number]), description: evil }],
      },
      ja,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    // AC-6 is about markup: no tag carries script, an external resource or an event attribute
    const tags = html.match(/<[^>]+>/g) ?? [];
    expect(tags.filter((tag) => /^<script|^<link|\ssrc=|\shref=|\son[a-z]+=/i.test(tag))).toEqual([]);
    expect(html).not.toMatch(/url\(/i);
  });
});
