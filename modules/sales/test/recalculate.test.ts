// Pure services of the sales module: recalculation shaping (AC-2), journal lines (AC-3), the hand-computed golden
// file (AC-9), AR aging buckets (AC-6), the default HTML renderer (AC-5) and fast-check properties.
import { readFileSync } from 'node:fs';
import { Decimal, type RoundingMode } from '@daifuku/kernel';
import { summarizeTax, type TaxCategory } from '@daifuku/mod-tax';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { agingRows, agingTotals, bucketFor, daysBetween } from '../src/services/aging.ts';
import {
  imbalance,
  journalLinesFor,
  ratePercent,
  type JournalLineSpec,
  type PostingInput,
} from '../src/services/posting.ts';
import {
  balanceOf,
  lineAmount,
  rateOfCategory,
  shapeSummary,
  totalsFrom,
  tryDecimal,
} from '../src/services/recalculate.ts';
import {
  defaultInvoiceHtml,
  escapeHtml,
  formatMoney,
  formatRate,
  REDUCED_MARK,
  type InvoiceRenderData,
} from '../src/services/render-html.ts';

// ---- golden (AC-9) ------------------------------------------------------------------------------------

const category = z.enum(['standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope']);
const goldenSchema = z.object({
  input: z.object({
    date: z.string(),
    priceIncludesTax: z.boolean(),
    scale: z.number().int(),
    partnerId: z.string(),
    rates: z.record(z.string(), z.string()),
    accounts: z.object({ receivable: z.string(), revenue: z.string(), taxPayable: z.string() }),
    lines: z.array(
      z.object({
        seq: z.number().int(),
        description: z.string(),
        quantity: z.string(),
        unitPrice: z.string(),
        taxCategory: category,
      }),
    ),
  }),
  expected: z.object({
    down: z.object({
      subtotal: z.string(),
      taxTotal: z.string(),
      total: z.string(),
      taxSummary: z.array(
        z.object({
          category,
          code: z.string(),
          label: z.string(),
          rate: z.string(),
          taxable: z.string(),
          tax: z.string(),
          gross: z.string(),
          lineCount: z.number().int(),
        }),
      ),
      journalLines: z.array(
        z.object({
          accountId: z.string(),
          debit: z.string().nullable(),
          credit: z.string().nullable(),
          partnerId: z.string().nullable(),
          taxCategory: category.nullable(),
          taxRate: z.string().nullable(),
          memo: z.string().nullable(),
        }),
      ),
    }),
    half_up: z.object({ subtotal: z.string(), taxTotal: z.string(), total: z.string(), taxes: z.array(z.string()) }),
    up: z.object({ subtotal: z.string(), taxTotal: z.string(), total: z.string(), taxes: z.array(z.string()) }),
  }),
});
const golden = goldenSchema.parse(
  JSON.parse(readFileSync(new URL('./golden/invoice-posting.json', import.meta.url), 'utf8')),
);

const rateOf = (rates: Record<string, string>, c: TaxCategory): string => rates[c] ?? '0';

/** The pure pipeline an invoice goes through: line amounts -> tax summary -> header totals -> journal lines. */
function pipeline(input: typeof golden.input, mode: RoundingMode) {
  const lines = input.lines.map((l) => ({ ...l, amount: lineAmount(l.quantity, l.unitPrice) }));
  const summary = summarizeTax(
    lines.map((l) => ({
      amount: l.amount,
      category: l.taxCategory,
      rate: rateOf(input.rates, l.taxCategory),
      priceIncludesTax: input.priceIncludesTax,
    })),
    { roundingMode: mode, scale: input.scale, priceIncludesTax: input.priceIncludesTax },
  );
  const totals = totalsFrom(summary);
  const journalLines = journalLinesFor(
    {
      partnerId: input.partnerId,
      priceIncludesTax: input.priceIncludesTax,
      lines,
      taxSummary: totals.taxSummary,
      total: totals.total,
    },
    input.accounts,
  );
  return { lines, totals, journalLines };
}

const jsonLine = (l: JournalLineSpec) => ({
  accountId: l.accountId,
  debit: l.debit?.toString() ?? null,
  credit: l.credit?.toString() ?? null,
  partnerId: l.partnerId ?? null,
  taxCategory: l.taxCategory ?? null,
  taxRate: l.taxRate?.toString() ?? null,
  memo: l.memo ?? null,
});

describe('AC-9 golden: invoice-posting.json', () => {
  it('rounding down: subtotal 3,134 / tax 180 + 106 / total 3,420 and the exact journal lines', () => {
    const { lines, totals, journalLines } = pipeline(golden.input, 'down');
    expect(lines.map((l) => l.amount.toString())).toEqual(['1234', '567', '1333']);
    expect(totals.subtotal.toString()).toBe(golden.expected.down.subtotal);
    expect(totals.taxTotal.toString()).toBe(golden.expected.down.taxTotal);
    expect(totals.total.toString()).toBe(golden.expected.down.total);
    expect(totals.taxSummary).toEqual(golden.expected.down.taxSummary);
    expect(journalLines.map(jsonLine)).toEqual(golden.expected.down.journalLines);
    expect(imbalance(journalLines).isZero()).toBe(true);
  });

  it.each(['half_up', 'up'] as const)('rounding %s changes only the tax lines', (mode) => {
    const { totals, journalLines } = pipeline(golden.input, mode);
    const exp = golden.expected[mode];
    expect([totals.subtotal.toString(), totals.taxTotal.toString(), totals.total.toString()]).toEqual([
      exp.subtotal,
      exp.taxTotal,
      exp.total,
    ]);
    expect(totals.taxSummary.map((g) => g.tax)).toEqual(exp.taxes);
    expect(
      journalLines.filter((l) => l.accountId === golden.input.accounts.taxPayable).map((l) => l.credit?.toString()),
    ).toEqual(exp.taxes);
    expect(journalLines[0]?.debit?.toString()).toBe(exp.total);
    expect(imbalance(journalLines).isZero()).toBe(true);
  });
});

// ---- recalculate (AC-1, AC-2) ---------------------------------------------------------------------------

describe('recalculate services', () => {
  it('AC-1 lineAmount is quantity × unitPrice, unrounded', () => {
    expect(lineAmount('3', '1234.5').toString()).toBe('3703.5');
    expect(lineAmount('0.333333', '3').toString()).toBe('0.999999');
    expect(lineAmount('-1', '100').toString()).toBe('-100');
  });

  it('tryDecimal accepts Decimal / decimal strings / integers and rejects the rest (left to zod)', () => {
    expect(tryDecimal(Decimal.from('1'))?.toString()).toBe('1');
    expect(tryDecimal('12.50')?.toString()).toBe('12.5');
    expect(tryDecimal(7)?.toString()).toBe('7');
    expect(tryDecimal('abc')).toBeNull();
    expect(tryDecimal(1.5)).toBeNull();
    expect(tryDecimal(null)).toBeNull();
    expect(tryDecimal(undefined)).toBeNull();
  });

  it('AC-2 shapeSummary/totalsFrom keep group order and code/label when present; balance = total − paid', () => {
    const summary = summarizeTax(
      [
        { amount: '1000', category: 'reduced', rate: '0.08' },
        { amount: '100', category: 'exempt', rate: '0' },
      ],
      { roundingMode: 'down', scale: 0 },
    );
    const rows = shapeSummary({
      ...summary,
      groups: summary.groups.map((g) => ({
        ...g,
        code: g.category === 'reduced' ? 'RED8' : 'EXEMPT',
        label: g.category === 'reduced' ? '軽減8%' : '免税',
      })),
    });
    expect(rows).toEqual([
      {
        category: 'reduced',
        code: 'RED8',
        label: '軽減8%',
        rate: '0.08',
        taxable: '1000',
        tax: '80',
        gross: '1080',
        lineCount: 1,
      },
      {
        category: 'exempt',
        code: 'EXEMPT',
        label: '免税',
        rate: '0',
        taxable: '100',
        tax: '0',
        gross: '100',
        lineCount: 1,
      },
    ]);
    const t = totalsFrom(summary);
    expect([t.subtotal.toString(), t.taxTotal.toString(), t.total.toString()]).toEqual(['1100', '80', '1180']);
    expect(t.taxSummary[0]?.code).toBe('');
    expect(rateOfCategory(rows, 'reduced')).toBe('0.08');
    expect(rateOfCategory(rows, 'standard')).toBe('0');
    expect(balanceOf('1180', '180').toString()).toBe('1000');
  });
});

// ---- posting (AC-3) --------------------------------------------------------------------------------------

const RATES: Record<string, string> = {
  standard: '0.10',
  reduced: '0.08',
  exempt: '0',
  non_taxable: '0',
  out_of_scope: '0',
};
const ACC = { receivable: 'ar', revenue: 'rev', taxPayable: 'tax' };

function postingFor(
  lines: { amount: string; taxCategory: TaxCategory; description?: string }[],
  priceIncludesTax: boolean,
  mode: RoundingMode = 'down',
) {
  const summary = summarizeTax(
    lines.map((l) => ({ amount: l.amount, category: l.taxCategory, rate: rateOf(RATES, l.taxCategory) })),
    { roundingMode: mode, scale: 0, priceIncludesTax },
  );
  const totals = totalsFrom(summary);
  const input: PostingInput = {
    partnerId: 'p1',
    priceIncludesTax,
    lines: lines.map((l, i) => ({
      seq: i + 1,
      description: l.description ?? `L${i + 1}`,
      amount: l.amount,
      taxCategory: l.taxCategory,
    })),
    taxSummary: totals.taxSummary,
    total: totals.total,
  };
  return { totals, journalLines: journalLinesFor(input, ACC) };
}

describe('posting service (AC-3)', () => {
  it('税込 invoices post revenue per rate group (税抜), not per line', () => {
    // 1,100 + 1,650 (10%, gross) -> 2,750 × 10 ÷ 110 = 250 tax, 2,500 net; 540 (8%) -> 40 tax, 500 net
    const { totals, journalLines } = postingFor(
      [
        { amount: '1100', taxCategory: 'standard' },
        { amount: '1650', taxCategory: 'standard' },
        { amount: '540', taxCategory: 'reduced' },
      ],
      true,
    );
    expect([totals.subtotal.toString(), totals.taxTotal.toString(), totals.total.toString()]).toEqual([
      '3000',
      '290',
      '3290',
    ]);
    expect(journalLines.map(jsonLine)).toEqual([
      {
        accountId: 'ar',
        debit: '3290',
        credit: null,
        partnerId: 'p1',
        taxCategory: null,
        taxRate: null,
        memo: '売掛金',
      },
      {
        accountId: 'rev',
        debit: null,
        credit: '2500',
        partnerId: null,
        taxCategory: 'standard',
        taxRate: '0.1',
        memo: 'standard 税抜',
      },
      {
        accountId: 'rev',
        debit: null,
        credit: '500',
        partnerId: null,
        taxCategory: 'reduced',
        taxRate: '0.08',
        memo: 'reduced 税抜',
      },
      {
        accountId: 'tax',
        debit: null,
        credit: '250',
        partnerId: null,
        taxCategory: 'standard',
        taxRate: '0.1',
        memo: '仮受消費税 10%',
      },
      {
        accountId: 'tax',
        debit: null,
        credit: '40',
        partnerId: null,
        taxCategory: 'reduced',
        taxRate: '0.08',
        memo: '仮受消費税 8%',
      },
    ]);
  });

  it('zero-rate lines get a revenue line with rate 0 and no tax line; zero amounts and zero tax are skipped', () => {
    const { journalLines } = postingFor(
      [
        { amount: '500', taxCategory: 'exempt' },
        { amount: '0', taxCategory: 'standard' },
        { amount: '1', taxCategory: 'standard' },
      ],
      false,
    );
    expect(journalLines.map((l) => [l.accountId, l.credit?.toString() ?? null, l.taxRate?.toString() ?? null])).toEqual(
      [
        ['ar', null, null],
        ['rev', '500', '0'],
        ['rev', '1', '0.1'],
      ],
    );
    expect(journalLines[0]?.debit?.toString()).toBe('501');
  });

  it('a negative (discount) line becomes a debit on revenue so every side stays >= 0', () => {
    const { journalLines } = postingFor(
      [
        { amount: '1000', taxCategory: 'standard' },
        { amount: '-100', taxCategory: 'standard', description: '値引' },
      ],
      false,
    );
    expect(journalLines.map(jsonLine)).toContainEqual({
      accountId: 'rev',
      debit: '100',
      credit: null,
      partnerId: null,
      taxCategory: 'standard',
      taxRate: '0.1',
      memo: '値引',
    });
    expect(journalLines[0]?.debit?.toString()).toBe('990');
    expect(imbalance(journalLines).isZero()).toBe(true);
  });

  it('ratePercent formats a rate for memos', () => {
    expect(ratePercent('0.1')).toBe('10%');
    expect(ratePercent('0.08')).toBe('8%');
    expect(ratePercent('0')).toBe('0%');
  });

  it('property: journal lines always balance and debit the receivable with the invoice total (税抜 and 税込, every rounding)', () => {
    const arbLine = fc.record({
      amount: fc.integer({ min: 1, max: 1_000_000 }).map(String),
      taxCategory: fc.constantFrom<TaxCategory>('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'),
    });
    fc.assert(
      fc.property(
        fc.array(arbLine, { minLength: 1, maxLength: 8 }),
        fc.boolean(),
        fc.constantFrom<RoundingMode>('down', 'half_up', 'up'),
        (lines, inclusive, mode) => {
          const { totals, journalLines } = postingFor(lines, inclusive, mode);
          expect(imbalance(journalLines).isZero()).toBe(true);
          expect(journalLines[0]).toMatchObject({ accountId: 'ar', partnerId: 'p1' });
          expect(journalLines[0]?.debit?.eq(totals.total)).toBe(true);
          expect(journalLines.every((l) => (l.debit === undefined) !== (l.credit === undefined))).toBe(true);
          expect(journalLines.every((l) => !(l.debit ?? l.credit ?? Decimal.zero()).isNegative())).toBe(true);
          const revenue = Decimal.sum(
            journalLines.filter((l) => l.accountId === 'rev').map((l) => l.credit ?? l.debit?.neg() ?? Decimal.zero()),
          );
          expect(revenue.eq(totals.subtotal)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---- aging (AC-6) ------------------------------------------------------------------------------------------

describe('aging service (AC-6)', () => {
  it('daysBetween is exact across month/year boundaries and leap days', () => {
    expect(daysBetween('2026-05-31', '2026-06-30')).toBe(30);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-06-30', '2026-05-31')).toBe(-30);
  });

  it('bucket boundaries: 0 -> not due, 1..30, 31..60, 61..90, 91+', () => {
    expect([-5, 0, 1, 30, 31, 60, 61, 90, 91, 400].map(bucketFor)).toEqual([
      'notDue',
      'notDue',
      'days1to30',
      'days1to30',
      'days31to60',
      'days31to60',
      'days61to90',
      'days61to90',
      'over90',
      'over90',
    ]);
  });

  it('agingRows groups per partner (first-appearance order), null due date is not due, totals add up', () => {
    const rows = agingRows(
      [
        { partnerId: 'b', dueDate: '2026-08-31', balance: Decimal.from('100') },
        { partnerId: 'a', dueDate: '2026-09-30', balance: Decimal.from('50') },
        { partnerId: 'b', dueDate: null, balance: Decimal.from('7') },
        { partnerId: 'b', dueDate: '2026-05-31', balance: Decimal.from('1000') },
      ],
      '2026-09-10',
    );
    expect([...rows.keys()]).toEqual(['b', 'a']);
    const b = rows.get('b');
    expect(
      [b?.notDue, b?.days1to30, b?.days31to60, b?.days61to90, b?.over90, b?.total].map((d) => d?.toString()),
    ).toEqual(['7', '100', '0', '0', '1000', '1107']);
    const totals = agingTotals(rows.values());
    expect([totals.notDue.toString(), totals.total.toString()]).toEqual(['57', '1157']);
  });

  it('property: Σbuckets = total per partner and Σtotals = Σinputs', () => {
    const arbItem = fc.record({
      partnerId: fc.constantFrom('p1', 'p2', 'p3'),
      dueDate: fc.option(
        fc
          .integer({ min: 0, max: 400 })
          .map((d) => `2026-${String(1 + (d % 12)).padStart(2, '0')}-${String(1 + (d % 28)).padStart(2, '0')}`),
        { nil: null },
      ),
      balance: fc.integer({ min: 0, max: 10_000_000 }).map((n) => Decimal.from(n)),
    });
    fc.assert(
      fc.property(fc.array(arbItem, { maxLength: 30 }), (items) => {
        const rows = agingRows(items, '2026-09-10');
        for (const r of rows.values())
          expect(Decimal.sum([r.notDue, r.days1to30, r.days31to60, r.days61to90, r.over90]).eq(r.total)).toBe(true);
        expect(agingTotals(rows.values()).total.eq(Decimal.sum(items.map((i) => i.balance)))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ---- render (AC-5) -----------------------------------------------------------------------------------------

const renderData: InvoiceRenderData = {
  issuer: {
    name: 'テスト株式会社',
    invoiceRegistrationNo: 'T1234567890123',
    postalCode: '100-0001',
    address: '東京都千代田区1-1',
    phone: '03-0000-0000',
    email: 'billing@example.com',
    bankInfo: 'テスト銀行 本店 普通 1234567',
  },
  invoice: {
    number: 'INV-2026-000001',
    date: '2026-04-10',
    dueDate: '2026-05-31',
    note: '<b>注</b> & co',
    priceIncludesTax: false,
  },
  recipient: { name: '得意先A', postalCode: '150-0001', address: '東京都渋谷区2-2' },
  lines: [
    {
      seq: 1,
      description: '商品A',
      quantity: '1',
      unitPrice: '1234',
      amount: '1234',
      taxCategory: 'standard',
      rate: '0.1',
    },
    {
      seq: 2,
      description: '食品C',
      quantity: '2.5',
      unitPrice: '533.2',
      amount: '1333',
      taxCategory: 'reduced',
      rate: '0.08',
    },
  ],
  taxSummary: [
    { category: 'standard', rate: '0.1', taxable: '1234', tax: '123', gross: '1357' },
    { category: 'reduced', rate: '0.08', taxable: '1333', tax: '106', gross: '1439' },
  ],
  totals: { subtotal: '2567', taxTotal: '229', total: '2796' },
  locale: 'ja',
};

describe('default invoice HTML (AC-5)', () => {
  it('contains the 6 記載事項: issuer + 登録番号, date, lines with ※, per-rate amounts and tax, recipient', () => {
    const html = defaultInvoiceHtml(renderData);
    expect(html).toContain('テスト株式会社');
    expect(html).toContain('登録番号: T1234567890123');
    expect(html).toContain('INV-2026-000001');
    expect(html).toContain('2026-04-10');
    expect(html).toContain('2026-05-31');
    expect(html).toContain('得意先A 御中');
    expect(html).toContain(`${REDUCED_MARK}食品C`);
    expect(html).not.toContain(`${REDUCED_MARK}商品A`);
    expect(html).toContain('課税（標準） 10%');
    expect(html).toContain('課税（軽減） 8%');
    expect(html).toContain('対価の額（税抜）');
    expect(html).toContain('>1,234<');
    expect(html).toContain('>1,333<');
    expect(html).toContain('>123<');
    expect(html).toContain('>106<');
    expect(html).toContain('>2,796<');
    expect(html).toContain('※は軽減税率対象');
    expect(html).toContain('テスト銀行 本店 普通 1234567');
    expect(html).toContain('〒150-0001 東京都渋谷区2-2');
    // user text is escaped
    expect(html).toContain('&lt;b&gt;注&lt;/b&gt; &amp; co');
    expect(html).not.toContain('<b>注</b>');
    expect(html.startsWith('<article class="invoice" lang="ja"')).toBe(true);
  });

  it('税込 invoices label the amount column 税込 and show gross per rate; drafts show （下書き）; en locale', () => {
    const html = defaultInvoiceHtml({
      ...renderData,
      invoice: { ...renderData.invoice, number: '', dueDate: null, note: null, priceIncludesTax: true },
    });
    expect(html).toContain('対価の額（税込）');
    expect(html).toContain('>1,357<');
    expect(html).toContain('（下書き）');
    expect(html).not.toContain('支払期日');
    expect(html).not.toContain('備考');
    const en = defaultInvoiceHtml({ ...renderData, locale: 'en' });
    expect(en).toContain('Registration no.: T1234567890123');
    expect(en).toContain('Taxable (reduced) 8%');
    expect(en).not.toContain('御中');
  });

  it('formatters: money grouping (string arithmetic), rate percent, escaping', () => {
    expect(formatMoney('1234567')).toBe('1,234,567');
    expect(formatMoney('1234567.50')).toBe('1,234,567.5');
    expect(formatMoney('-1000')).toBe('-1,000');
    expect(formatMoney('12')).toBe('12');
    expect(formatMoney('n/a')).toBe('n/a');
    expect(formatRate('0.10')).toBe('10%');
    expect(formatRate('0')).toBe('0%');
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
