// docs/specs/print-templates.md AC-6, AC-7, AC-9, AC-13, AC-14, AC-18: golden HTML of the default 領収書 and 支払通知書
// layouts (fixed render data, Japanese), plus English, escaping and the registration-number rule. Update a golden
// with `vitest -u` only for a deliberate layout change and record why in docs/log.
import { printTools } from '@daifuku/mod-print-layout';
import { describe, expect, it } from 'vitest';
import {
  defaultPaymentNoticeHtml,
  defaultReceiptHtml,
  type PaymentDocumentRenderData,
} from '../src/services/payment-html.ts';

const era = (d: string) => `令和${Number(d.slice(0, 4)) - 2018}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const ja = printTools('ja', 'both', era);
const en = printTools('en', 'western');

const issuer = {
  name: '大福商事株式会社',
  invoiceRegistrationNo: 'T1234567890123',
  postalCode: '100-0001',
  address: '東京都千代田区1-1',
  phone: '03-0000-0000',
  bankInfo: 'テスト銀行 本店 普通 1234567',
};

const receipt: PaymentDocumentRenderData = {
  issuer,
  recipient: { name: '得意先A', postalCode: '150-0001', address: '東京都 渋谷区2-2' },
  payment: {
    number: 'PAY-2026-000010',
    date: '2026-10-25',
    amount: '50000',
    method: 'bank_transfer',
    unallocated: '4600',
    docstatus: 1,
    note: '10月分',
  },
  allocations: [
    { invoiceNumber: 'INV-2026-000001', invoiceDate: '2026-10-01', supplierInvoiceNo: null, amount: '33000' },
    { invoiceNumber: 'INV-2026-000002', invoiceDate: '2026-10-08', supplierInvoiceNo: null, amount: '12400' },
  ],
  locale: 'ja',
};

const notice: PaymentDocumentRenderData = {
  issuer,
  recipient: { name: '仕入先B', postalCode: '530-0001', address: '大阪府 大阪市北区3-3' },
  payment: {
    number: 'PAY-2026-000011',
    date: '2026-10-31',
    amount: '22000',
    method: 'cash',
    unallocated: '0',
    docstatus: 1,
    note: null,
  },
  allocations: [
    { invoiceNumber: 'PINV-2026-000004', invoiceDate: '2026-10-15', supplierInvoiceNo: 'B-778', amount: '22000' },
  ],
  locale: 'ja',
};

describe('payment print layouts: golden (AC-13, AC-14)', () => {
  it('AC-13 golden: test/golden/receipt.html', async () => {
    await expect(defaultReceiptHtml(receipt, ja)).toMatchFileSnapshot('./golden/receipt.html');
  });
  it('AC-14 golden: test/golden/payment-notice.html', async () => {
    await expect(defaultPaymentNoticeHtml(notice, ja)).toMatchFileSnapshot('./golden/payment-notice.html');
  });
});

describe('payment print layouts: content (AC-6, AC-7, AC-9, AC-13, AC-14, AC-18)', () => {
  it('AC-13 the receipt: number, date, amount, method, addressee, issuer with registration no., allocations, advance', () => {
    const html = defaultReceiptHtml(receipt, ja);
    for (const s of [
      '>領収書<',
      'PAY-2026-000010',
      '2026年10月25日（令和8年10月25日）',
      '50,000円',
      '>振込<',
      '得意先A 御中',
      '登録番号: T1234567890123',
      '>INV-2026-000001<',
      '>33,000<',
      '前受金（未消込）',
      '>4,600<',
      '10月分',
    ])
      expect(html).toContain(s);
    // no tax breakdown, revenue-stamp box or stamp-duty wording (spec open question 1); no bank details
    for (const s of ['税率', '消費税', '印紙', 'テスト銀行']) expect(html).not.toContain(s);
  });

  it('AC-14 / AC-9 the payment notice: supplier invoice numbers, no advance row at zero, no buyer registration no.', () => {
    const html = defaultPaymentNoticeHtml(notice, ja);
    expect(html).toContain('>支払通知書<');
    expect(html).toContain('>B-778<');
    expect(html).toContain('貴社請求書番号');
    expect(html).toContain('>現金<');
    expect(html).toContain('仕入先B 御中');
    expect(html).not.toContain('前払金');
    expect(html).not.toContain('T1234567890123');
  });

  it('AC-13 a payment without allocations shows the empty row and the whole amount as advance', () => {
    const html = defaultReceiptHtml(
      { ...receipt, allocations: [], payment: { ...receipt.payment, unallocated: '50000' } },
      ja,
    );
    expect(html).toContain('請求書への消込はありません');
    expect(html).toContain('前受金（未消込）');
  });

  it('AC-7 amounts print as stored', () => {
    const html = defaultReceiptHtml({ ...receipt, payment: { ...receipt.payment, amount: '50000.5' } }, ja);
    expect(html).toContain('50,000.5円');
  });

  it('AC-18 English labels; no 御中', () => {
    const html = defaultPaymentNoticeHtml({ ...notice, locale: 'en' }, en);
    expect(html).toContain('>Payment notice<');
    expect(html).toContain('Your invoice no.');
    expect(html).toContain('2026-10-31');
    expect(html).not.toContain('御中');
    expect(defaultReceiptHtml({ ...receipt, locale: 'en' }, en)).toContain('Advance received (unallocated)');
  });

  it('AC-6 record strings are escaped; no active markup', () => {
    const evil = '"><script>alert(1)</script>';
    const html = defaultReceiptHtml(
      { ...receipt, recipient: { name: evil }, payment: { ...receipt.payment, note: evil } },
      ja,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});
