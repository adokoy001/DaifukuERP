// Scenario test for the retail pack: runs the business script docs/domain/scenario-retail.md (食品雑貨店「まめや」の 2026年11月)
// in-process (runAction / repo, no HTTP), in script order, and asserts every expected figure of that document. Starts from
// the module seeds and pack.apply (settings / seed / sample). Test DB: daifuku_test_retail (TEST_DATABASE_URL_OWNER /
// TEST_DATABASE_URL). docs/specs/pack-retail.md AC-10. After the November figures: cancel (AC-4) and the next month (AC-7).
import { DOCSTATUS, getCompany, readAppliedPacks, appMeta, registry, ValidationError } from '@daifuku/kernel';
import { CLOSING_ACCOUNTS_KEY, RETAIL_SETTING_DEFAULTS } from '../src/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caught, createSubmit, entryLines, entryTaxTags, loadAccounts, seedModules, setupScenario, sum, type DocJson, type ListJson, type Row, type Scenario, type Table } from './fixture.ts';

type ClosingJson = DocJson & { date: string; warehouseId: string; subtotal: string; taxTotal: string; total: string; cashAmount: string; cardAmount: string; salesInvoiceId: string | null; paymentId: string | null; taxSummary: Row[] };
type InvoiceJson = DocJson & { partnerId: string; date: string; priceIncludesTax: boolean; subtotal: string; taxTotal: string; total: string; paidAmount: string; balance: string; status: string; note: string | null; journalEntryId: string | null };
type PaymentJson = DocJson & { accountId: string; amount: string; method: string; journalEntryId: string | null };

let s: Scenario;
const product: Record<string, string> = {};
const partner: Record<string, string> = {};
const closing: Record<string, ClosingJson> = {};
const invoice: Record<string, InvoiceJson> = {};
let bill1: InvoiceJson & { deductibleTax: string };
let main = '';

beforeAll(async () => {
  s = await setupScenario();
});
afterAll(async () => {
  await s.close();
});

const closingLines = (qty: Record<string, string>) => ({ retail_closing_line: Object.entries(qty).map(([code, quantity]) => ({ productId: product[code], quantity })) });

describe('台本: 食品雑貨店「まめや」の 2026年11月 (docs/domain/scenario-retail.md)', () => {
  it('1. 会計年度・モジュール seed・pack.apply（sample）: 設定・勘定科目 5050/5100/6990・店頭客・品目 P1..P4・仕入先 S1、2 回目は no-op、force で税込入力', async () => {
    await s.act('accounting.open_fiscal_year', { startDate: '2026-01-01' });
    expect(await seedModules(s)).toEqual(['partner', 'product', 'tax', 'accounting', 'inventory', 'l10n_jp']);
    const first = await s.act<Row>('pack.apply', { name: 'retail', sample: true, force: true });
    // This fixture explicitly selects the pack defaults; an ordinary apply preserves existing company settings.
    expect(first).toMatchObject({ name: 'retail', version: '0.1.0', alreadyApplied: false, seeded: true, sampled: true });
    expect(first.settings).toEqual({ written: ['tax.price_includes_tax', 'inventory.allow_negative_stock', 'inventory.auto_issue_on_sales', 'inventory.auto_receipt_on_purchase', CLOSING_ACCOUNTS_KEY], kept: [] });
    expect((await s.run(getCompany)).settings['tax.price_includes_tax']).toBe(true);
    const second = await s.act<Row>('pack.apply', { name: 'retail', sample: true });
    expect(second).toMatchObject({ alreadyApplied: true, seeded: false, sampled: false, settings: { written: [] } });
    const forced = await s.act<Row>('pack.apply', { name: 'retail', force: true });
    expect(forced).toMatchObject({ alreadyApplied: true, seeded: true, settings: { kept: [] } });
    const settings = (await s.run(getCompany)).settings;
    for (const [key, value] of Object.entries(RETAIL_SETTING_DEFAULTS)) expect(settings[key], key).toEqual(value);
    expect(settings[CLOSING_ACCOUNTS_KEY]).toEqual({ inventory: '1400', closingStock: '5100', openingStock: '5050' });

    await loadAccounts(s);
    const accounts = await s.act<ListJson>('account.list', { where: { code: { $in: ['1400', '5050', '5100', '6990'] } }, orderBy: [{ field: 'code', dir: 'asc' }] });
    expect(accounts.items.map((a) => [a.code, a.name, a.type, a.taxCategoryDefault])).toEqual([
      ['1400', '商品', 'asset', null],
      ['5050', '期首商品棚卸高', 'expense', null],
      ['5100', '期末商品棚卸高', 'expense', null],
      ['6990', '棚卸減耗損', 'expense', null],
    ]);
    const partners = await s.act<ListJson>('partner.list', { where: { code: { $in: ['WALKIN', 'S1'] } }, orderBy: [{ field: 'code', dir: 'asc' }] });
    expect(partners.items.map((p) => [p.code, p.name, p.isCustomer, p.isSupplier, p.ext])).toEqual([
      ['S1', '卸売商事', false, true, { retailKind: 'wholesaler' }],
      ['WALKIN', '店頭客', true, false, { retailKind: 'walk_in' }],
    ]);
    for (const p of partners.items) partner[String(p.code)] = String(p.id);
    const products = await s.act<ListJson>('product.list', { where: { code: { $in: ['P1', 'P2', 'P3', 'P4'] } }, orderBy: [{ field: 'code', dir: 'asc' }] });
    expect(products.items.map((p) => [p.code, p.name, p.kind, p.taxCategory, p.salePrice, p.purchasePrice, (p.ext as Row).jan])).toEqual([
      ['P1', '弁当', 'goods', 'reduced', '540', '300', '2000000000015'],
      ['P2', 'お茶', 'goods', 'reduced', '162', '80', '2000000000022'],
      ['P3', '雑貨', 'goods', 'standard', '1100', '600', '2000000000039'],
      ['P4', '文具', 'goods', 'standard', '330', '150', '2000000000046'],
    ]);
    for (const p of products.items) product[String(p.code)] = String(p.id);
    // AC-1 ext: searchable JAN, list filter on ext.jan, enum validation on ext.retailKind
    expect((await s.act<ListJson>('product.list', { search: '2000000000039' })).items.map((p) => p.code)).toEqual(['P3']);
    expect((await s.act<ListJson>('product.list', { where: { 'ext.shelf': 'A-02' } })).items.map((p) => p.code)).toEqual(['P2']);
    const badKind = await caught(s.act('partner.create', { name: 'X', ext: { retailKind: 'vip' } }));
    expect(badKind).toBeInstanceOf(ValidationError);
    expect(registry.extFields('product').map((d) => [d.key, d.source])).toEqual([
      ['jan', 'pack:retail'],
      ['supplierCode', 'pack:retail'],
      ['shelf', 'pack:retail'],
    ]);
    const mainWh = await s.act<ListJson>('warehouse.list', { where: { code: 'MAIN' } });
    main = String(mainWh.items[0]?.id);
  });

  it('2. 期首 JE0（11-01）: 元入金 200,000 → Dr 1100 普通預金 / Cr 3000 元入金', async () => {
    const je0 = await createSubmit<DocJson & { totalDebit: string }>(s, 'journal_entry', {
      date: '2026-11-01',
      description: 'JE0 元入金',
      lines: { journal_line: [{ accountId: s.acc['1100'], debit: '200000' }, { accountId: s.acc['3000'], credit: '200000' }] },
    });
    expect(je0).toMatchObject({ docstatus: DOCSTATUS.submitted, totalDebit: '200000' });
    expect(await entryLines(s, je0.id)).toEqual([
      ['1100', '200000', '0'],
      ['3000', '0', '200000'],
    ]);
  });

  it('3. 仕入 BILL1（11-01、S1、税抜入力）: 税抜 41,000 / 税 3,640（軽減 23,000→1,840、標準 18,000→1,800）/ 税込 44,640、自動入庫（移動平均 = 仕入単価）', async () => {
    const qty: Record<string, [string, string]> = { P1: ['50', '300'], P2: ['100', '80'], P3: ['20', '600'], P4: ['40', '150'] };
    bill1 = await createSubmit(s, 'purchase_invoice', {
      partnerId: partner.S1,
      date: '2026-11-01',
      priceIncludesTax: false,
      lines: { purchase_invoice_line: Object.entries(qty).map(([code, [quantity, unitPrice]]) => ({ productId: product[code], quantity, unitPrice })) },
    });
    expect(bill1).toMatchObject({ docstatus: DOCSTATUS.submitted, status: 'open', priceIncludesTax: false, subtotal: '41000', taxTotal: '3640', deductibleTax: '3640', total: '44640', balance: '44640' });
    expect(await entryLines(s, bill1.journalEntryId)).toEqual([
      ['5000', '23000', '0'],
      ['1500', '1840', '0'],
      ['5000', '18000', '0'],
      ['1500', '1800', '0'],
      ['2100', '0', '44640'],
    ]);
    const receipts = await s.act<ListJson>('stock_entry.list', { where: { sourceEntity: 'purchase_invoice', sourceId: bill1.id } });
    expect(receipts.items.map((e) => [e.type, e.docstatus, e.warehouseId])).toEqual([['receipt', DOCSTATUS.submitted, main]]);
    const onHand = await s.act<Table>('inventory.stock_on_hand', {});
    expect(onHand.rows.map((r) => [r.productCode, r.qty, r.avgCost, r.value])).toEqual([
      ['P1', '50', '300', '15000'],
      ['P2', '100', '80', '8000'],
      ['P3', '20', '600', '12000'],
      ['P4', '40', '150', '6000'],
    ]);
    expect(onHand.totals?.value).toBe('41000');
  });

  it('4. AC-3 検算: 現金 + カード ≠ 税込合計 → VALIDATION（hint に差額）、数量 0 → VALIDATION、何も書かれない', async () => {
    const before = (await s.act<ListJson>('retail_closing.list', {})).total;
    const short = await caught(s.act('retail_closing.create', { date: '2026-11-05', cashAmount: '20000', cardAmount: '4000', lines: closingLines({ P1: '20', P2: '30', P3: '5', P4: '10' }) }));
    expect(short).toBeInstanceOf(ValidationError);
    expect(short).toMatchObject({ code: 'VALIDATION', hint: expect.stringContaining('差額 460') });
    const zero = await caught(s.act('retail_closing.create', { date: '2026-11-05', lines: closingLines({ P1: '0' }) }));
    expect(zero).toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'quantity' }] } });
    expect((await s.act<ListJson>('retail_closing.list', {})).total).toBe(before);
  });

  it('5. レジ締め REG1〜REG3（税込・税率ごと・締めごとに切捨て）: 売上請求書（店頭客・税込）＋自動出庫＋現金入金、カード分は売掛金', async () => {
    const script = [
      ['REG1', '2026-11-05', { P1: '20', P2: '30', P3: '5', P4: '10' }, '20000', '4460'],
      ['REG2', '2026-11-15', { P1: '25', P2: '40', P3: '8', P4: '15' }, '33730', '0'],
      ['REG3', '2026-11-25', { P1: '3', P2: '5', P3: '2', P4: '-1' }, '0', '4300'],
    ] as const;
    for (const [no, date, qty, cashAmount, cardAmount] of script) {
      const draft = await s.act<ClosingJson>('retail_closing.create', { date, cashAmount, cardAmount, lines: closingLines(qty) });
      expect(draft, `${no} draft defaults`).toMatchObject({ docstatus: DOCSTATUS.draft, warehouseId: main, salesInvoiceId: null, paymentId: null });
      const draftLines = (draft.lines as { retail_closing_line: Row[] }).retail_closing_line;
      expect(draftLines.map((l) => [l.unitPrice, l.taxCategory]), `${no} unit price / tax category from the product`).toEqual([
        ['540', 'reduced'],
        ['162', 'reduced'],
        ['1100', 'standard'],
        ['330', 'standard'],
      ]);
      await s.act('retail_closing.submit', { id: draft.id });
      closing[no] = await s.act<ClosingJson>('retail_closing.get', { id: draft.id });
      const inv = closing[no]?.salesInvoiceId;
      expect(inv, `${no} invoice`).toEqual(expect.any(String));
      invoice[no] = await s.act<InvoiceJson>('sales_invoice.get', { id: String(inv) });
    }
    const expected = [
      // no, number, 税抜, 税額, 税込, 現金, カード, 軽減 [税抜, 税], 標準 [税抜, 税]
      ['REG1', 'REG-2026-000001', '22500', '1960', '24460', '20000', '4460', ['14500', '1160'], ['8000', '800']],
      ['REG2', 'REG-2026-000002', '31000', '2730', '33730', '33730', '0', ['18500', '1480'], ['12500', '1250']],
      ['REG3', 'REG-2026-000003', '3950', '350', '4300', '0', '4300', ['2250', '180'], ['1700', '170']],
    ] as const;
    for (const [no, number, subtotal, taxTotal, total, cash, card, reduced, standard] of expected) {
      const c = closing[no];
      const i = invoice[no];
      if (!c || !i) throw new TypeError(`${no} missing`);
      expect(c).toMatchObject({ docstatus: DOCSTATUS.submitted, number, subtotal, taxTotal, total, cashAmount: cash, cardAmount: card });
      expect(c.taxSummary.map((g) => [g.category, g.rate, g.taxable, g.tax])).toEqual([
        ['reduced', '0.08', ...reduced],
        ['standard', '0.1', ...standard],
      ]);
      expect(i, `${no} invoice`).toMatchObject({ docstatus: DOCSTATUS.submitted, partnerId: partner.WALKIN, date: c.date, priceIncludesTax: true, subtotal, taxTotal, total, paidAmount: cash, balance: card, status: card === '0' ? 'paid' : 'open', note: `レジ締め ${number}` });
      // 売上の転記（税込入力: 税率ごとに 1 行）: Dr 1300 税込 / Cr 4000 軽減税抜 / Cr 4000 標準税抜 / Cr 2200 軽減税 / Cr 2200 標準税
      expect(await entryLines(s, i.journalEntryId), `${no} sales entry`).toEqual([
        ['1300', total, '0'],
        ['4000', '0', reduced[0]],
        ['4000', '0', standard[0]],
        ['2200', '0', reduced[1]],
        ['2200', '0', standard[1]],
      ]);
      expect((await entryTaxTags(s, i.journalEntryId)).slice(1)).toEqual([
        ['4000', 'reduced', '0.08'],
        ['4000', 'standard', '0.1'],
        ['2200', 'reduced', '0.08'],
        ['2200', 'standard', '0.1'],
      ]);
      if (cash === '0') {
        expect(c.paymentId, `${no} no cash receipt`).toBeNull();
      } else {
        const pay = await s.act<PaymentJson>('payment.get', { id: String(c.paymentId) });
        expect(pay).toMatchObject({ docstatus: DOCSTATUS.submitted, direction: 'receive', partnerId: partner.WALKIN, method: 'cash', accountId: s.acc['1000'], amount: cash, allocatedAmount: cash, unallocatedAmount: '0' });
        expect(await entryLines(s, pay.journalEntryId), `${no} cash entry`).toEqual([
          ['1000', cash, '0'],
          ['1300', '0', cash],
        ]);
      }
    }
    // stock issues: goods lines with quantity > 0 only — REG3's return (P4 −1) is not received back (ひっかけ 3)
    const issues = await s.act<ListJson>('stock_entry.list', { where: { type: 'issue', docstatus: DOCSTATUS.submitted }, orderBy: [{ field: 'date', dir: 'asc' }] });
    expect(issues.items.map((e) => e.sourceId)).toEqual([invoice.REG1?.id, invoice.REG2?.id, invoice.REG3?.id]);
    const reg3Issue = await s.act<Row>('stock_entry.get', { id: String(issues.items[2]?.id) });
    expect((reg3Issue.lines as { stock_entry_line: Row[] }).stock_entry_line.map((l) => [l.productId, l.quantity])).toEqual([
      [product.P1, '3'],
      [product.P2, '5'],
      [product.P3, '2'],
    ]);
    expect(sum(expected.map((e) => e[2])), '月次 税抜').toBe('57450');
    expect(sum(expected.map((e) => e[3])), '月次 税額').toBe('5040');
    expect(sum(expected.map((e) => e[4])), '月次 税込').toBe('62490');
  });

  it('6. 11-20 BILL1 を全額支払（普通預金 1100）: Dr 2100 44,640 / Cr 1100 44,640 → paid', async () => {
    const pay = await createSubmit<PaymentJson>(s, 'payment', { direction: 'pay', partnerId: partner.S1, date: '2026-11-20', amount: '44640', method: 'bank_transfer', lines: { payment_allocation: [{ invoiceEntity: 'purchase_invoice', invoiceId: bill1.id, amount: '44640' }] } });
    expect(pay).toMatchObject({ docstatus: DOCSTATUS.submitted, accountId: s.acc['1100'] });
    expect(await entryLines(s, pay.journalEntryId)).toEqual([
      ['2100', '44640', '0'],
      ['1100', '0', '44640'],
    ]);
    expect(await s.act('purchase_invoice.get', { id: bill1.id })).toMatchObject({ status: 'paid', balance: '0' });
  });

  it('7. 棚卸 CNT1（11-30）: 帳簿 P1 2 / P2 25 / P3 5 / P4 15、実地 1 / 25 / 5 / 16 → 差異 −1（減耗 300）と +1（返品 150）', async () => {
    const counted: Record<string, string> = { P1: '1', P2: '25', P3: '5', P4: '16' };
    const cnt = await s.act<DocJson>('stock_count.create', { date: '2026-11-30', lines: { stock_count_line: Object.entries(counted).map(([code, countedQty]) => ({ productId: product[code], countedQty })) } });
    const draftLines = ((await s.act<Row>('stock_count.get', { id: cnt.id })).lines as { stock_count_line: Row[] }).stock_count_line;
    expect(draftLines.map((l) => [l.systemQty, l.countedQty, l.varianceQty])).toEqual([
      ['2', '1', '-1'],
      ['25', '25', '0'],
      ['5', '5', '0'],
      ['15', '16', '1'],
    ]);
    await s.act('stock_count.submit', { id: cnt.id });
    const variance = await s.act<Table>('inventory.count_variance', { countId: cnt.id });
    expect(variance.rows.map((r) => [r.productCode, r.systemQty, r.countedQty, r.varianceQty, r.unitCost, r.varianceValue])).toEqual([
      ['P1', '2', '1', '-1', '300', '-300'],
      // a submitted count reports the cost of its adjustment lines; products without variance have none (unit cost 0)
      ['P2', '25', '25', '0', '0', '0'],
      ['P3', '5', '5', '0', '0', '0'],
      ['P4', '15', '16', '1', '150', '150'],
    ]);
  });

  it('8. 在庫評価（11-30、移動平均）: P1 300 + P2 2,000 + P3 3,000 + P4 2,400 = 7,700', async () => {
    const v = await s.act<Table>('inventory.valuation', { asOf: '2026-11-30' });
    expect(v.rows.map((r) => [r.productCode, r.qty, r.avgCost, r.value])).toEqual([
      ['P1', '1', '300', '300'],
      ['P2', '25', '80', '2000'],
      ['P3', '5', '600', '3000'],
      ['P4', '16', '150', '2400'],
    ]);
    expect(v.totals?.value).toBe('7700');
  });

  it('9. retail.close_month 2026-11: Dr 1400 商品 7,700 / Cr 5100 期末商品棚卸高 7,700（初月なので期首振替なし）、2 回目は何もしない', async () => {
    const closed = await s.act<Row>('retail.close_month', { period: '2026-11' });
    expect(closed).toMatchObject({ period: '2026-11', asOf: '2026-11-30', valuationTotal: '7700', openingAmount: '0', alreadyClosed: false, journalEntryId: expect.any(String) });
    expect(await entryLines(s, closed.journalEntryId)).toEqual([
      ['1400', '7700', '0'],
      ['5100', '0', '7700'],
    ]);
    expect(await s.act('journal_entry.get', { id: String(closed.journalEntryId) })).toMatchObject({ date: '2026-11-30', sourceEntity: 'retail_month_close', docstatus: DOCSTATUS.submitted });
    const entriesBefore = (await s.act<ListJson>('journal_entry.list', {})).total;
    expect(await s.act('retail.close_month', { period: '2026-11' })).toEqual({ ...closed, alreadyClosed: true });
    expect((await s.act<ListJson>('journal_entry.list', {})).total).toBe(entriesBefore);
    expect((await s.act<ListJson>('retail_month_close.list', {})).total).toBe(1);
  });

  it('10. 試算表（11/01〜11/30）: 全行と合計 413,200、損益 売上 57,450 − 売上原価 33,300 = 24,150', async () => {
    const tb = await s.act<Table>('accounting.trial_balance', { from: '2026-11-01', to: '2026-11-30' });
    const expected: Record<string, [string, string, string]> = {
      '1000': ['53730', '0', '53730'],
      '1100': ['200000', '44640', '155360'],
      '1300': ['62490', '53730', '8760'],
      '1400': ['7700', '0', '7700'],
      '1500': ['3640', '0', '3640'],
      '2100': ['44640', '44640', '0'],
      '2200': ['0', '5040', '-5040'],
      '3000': ['0', '200000', '-200000'],
      '4000': ['0', '57450', '-57450'],
      '5000': ['41000', '0', '41000'],
      '5100': ['0', '7700', '-7700'],
    };
    const byCode = new Map(tb.rows.map((r) => [String(r.code), r]));
    for (const [code, [debit, credit, balance]] of Object.entries(expected)) {
      expect([byCode.get(code)?.openingDebit, byCode.get(code)?.openingCredit], `${code} 期首ゼロ`).toEqual(['0', '0']);
      expect([byCode.get(code)?.periodDebit, byCode.get(code)?.periodCredit, byCode.get(code)?.closingBalance], `${code}`).toEqual([debit, credit, balance]);
    }
    for (const r of tb.rows) {
      if (!expected[String(r.code)]) expect([r.periodDebit, r.periodCredit, r.closingBalance], `${String(r.code)} ${String(r.name)} idle`).toEqual(['0', '0', '0']);
    }
    expect(tb.totals).toMatchObject({ periodDebit: '413200', periodCredit: '413200', closingBalance: '0' });
    const net = (type: string) => sum(tb.rows.filter((r) => r.type === type).map((r) => r.closingBalance));
    expect(net('revenue'), '売上高').toBe('-57450');
    expect(net('expense'), '売上原価 = 期首 0 + 仕入 41,000 − 期末 7,700').toBe('33300');
    expect(sum([net('revenue'), net('expense')]), '売上総利益（貸方−）').toBe('-24150');
  });

  it('11. retail.daily_sales（11/01〜11/30）: 日ごとの 税抜・税 8%/10%・税込・現金・カード・件数、合計', async () => {
    const t = await s.act<Table>('retail.daily_sales', { from: '2026-11-01', to: '2026-11-30' });
    expect(t.columns.map((c) => c.key)).toEqual(['date', 'subtotal', 'tax_reduced_8', 'tax_standard_10', 'taxTotal', 'total', 'cashAmount', 'cardAmount', 'count']);
    expect(t.columns[2]?.label).toEqual({ ja: '消費税 8%（軽減税率）', en: 'Tax 8% (Reduced rate)' });
    expect(t.rows).toEqual([
      { date: '2026-11-05', subtotal: '22500', tax_reduced_8: '1160', tax_standard_10: '800', taxTotal: '1960', total: '24460', cashAmount: '20000', cardAmount: '4460', count: 1 },
      { date: '2026-11-15', subtotal: '31000', tax_reduced_8: '1480', tax_standard_10: '1250', taxTotal: '2730', total: '33730', cashAmount: '33730', cardAmount: '0', count: 1 },
      { date: '2026-11-25', subtotal: '3950', tax_reduced_8: '180', tax_standard_10: '170', taxTotal: '350', total: '4300', cashAmount: '0', cardAmount: '4300', count: 1 },
    ]);
    expect(t.totals).toEqual({ subtotal: '57450', tax_reduced_8: '2820', tax_standard_10: '2220', taxTotal: '5040', total: '62490', cashAmount: '53730', cardAmount: '8760', count: '3' });
    expect((await s.act<Table>('retail.daily_sales', { from: '2026-11-06', to: '2026-11-15' })).totals).toMatchObject({ total: '33730', count: '1' });
    await expect(s.act('retail.daily_sales', { from: '2026-11-30', to: '2026-11-01' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('12. 売掛残（カード分）8,760: REG1 の請求書 4,460 + REG3 の請求書 4,300（payment.outstanding・元帳 1300 と一致）', async () => {
    const ar = await s.act<Table>('payment.outstanding', { direction: 'receive' });
    expect(ar.rows.map((r) => [r.number, r.balance])).toEqual([
      [invoice.REG1?.number, '4460'],
      [invoice.REG3?.number, '4300'],
    ]);
    expect(ar.totals?.balance).toBe('8760');
  });

  it('13. 消費税集計表（11/01〜11/30）: 売上 標準 22,200 / 2,220・軽減 35,250 / 2,820、仕入 標準 18,000 / 1,800・軽減 23,000 / 1,840、差引 1,400', async () => {
    const t = await s.act<Table>('accounting.tax_period_summary', { from: '2026-11-01', to: '2026-11-30' });
    expect(t.rows.map((r) => [r.side, r.taxCategory, r.taxRate, r.taxableAmount, r.taxAmount, r.count])).toEqual([
      ['売上', 'standard', '0.10', '22200', '2220', 6],
      ['売上', 'reduced', '0.08', '35250', '2820', 6],
      ['仕入', 'standard', '0.10', '18000', '1800', 2],
      ['仕入', 'reduced', '0.08', '23000', '1840', 2],
    ]);
    expect(t.totals).toEqual({ output_tax_total: '5040', input_tax_total: '3640', net_tax_due: '1400' });
  });

  it('14. ラベル・メニュー・ext（AC-8, AC-1）: sales_invoice「売上（店頭/掛）」、partner「取引先（店頭客・仕入先）」、小売メニュー', async () => {
    const meta = await s.run(async (ctx) => appMeta(ctx, { appliedPacks: Object.keys(await readAppliedPacks(ctx)) }));
    expect(meta.entities.find((e) => e.name === 'sales_invoice')?.label).toEqual({ ja: '売上（店頭/掛）', en: 'Sales (register / credit)' });
    expect(meta.entities.find((e) => e.name === 'partner')?.label).toEqual({ ja: '取引先（店頭客・仕入先）', en: 'Partners (walk-in / suppliers)' });
    expect(meta.packs).toEqual([{ name: 'retail', label: { ja: '小売', en: 'Retail' }, applied: true }]);
    expect(meta.modules.find((m) => m.name === 'retail')?.menus.map((m) => m.label.ja)).toEqual(['レジ締め', '日次売上', '月次締め']);
    expect(meta.entities.find((e) => e.name === 'product')?.extFields.map((x) => [x.name, x.searchable])).toEqual([
      ['ext.jan', true],
      ['ext.supplierCode', undefined],
      ['ext.shelf', undefined],
    ]);
    expect(meta.entities.find((e) => e.name === 'retail_closing')?.module).toBe('retail');
  });
});

describe('台本の後（12月）: 取消（AC-4）と翌月の月次締め（AC-7）', () => {
  it('AC-4 取消: sales ロールで締め・submit できる。請求書は単独で取消できない（締めが参照）→ 締めを取消すと 現金入金 → 請求書 の順に取消、在庫は戻る', async () => {
    const clerk = { roles: ['sales'], actor: { type: 'user' as const, id: s.db.adminUserId } };
    const draft = await s.act<ClosingJson>('retail_closing.create', { date: '2026-12-01', cashAmount: '1100', lines: closingLines({ P3: '1' }) }, clerk);
    await s.act('retail_closing.submit', { id: draft.id }, clerk);
    const c = await s.act<ClosingJson>('retail_closing.get', { id: draft.id });
    expect(c).toMatchObject({ docstatus: DOCSTATUS.submitted, total: '1100', subtotal: '1000', taxTotal: '100' });
    expect((await s.act<Table>('inventory.stock_on_hand', { asOf: '2026-12-01' })).rows.find((r) => r.productCode === 'P3')?.qty).toBe('4');
    await expect(s.act('sales_invoice.cancel', { id: String(c.salesInvoiceId) })).rejects.toMatchObject({ code: 'HAS_DEPENDENTS' });
    await expect(s.act('payment.cancel', { id: String(c.paymentId) })).rejects.toMatchObject({ code: 'HAS_DEPENDENTS' });
    // a patch cannot re-point the system-owned links of a submitted closing (stripped from the patch)
    await s.act('retail_closing.update', { id: c.id, patch: { salesInvoiceId: null } });
    expect((await s.act<ClosingJson>('retail_closing.get', { id: c.id })).salesInvoiceId).toBe(c.salesInvoiceId);

    // the cascade runs in the caller's context: sales alone may not cancel the cash receipt (payment.cancel is accounting's)
    await expect(s.act('retail_closing.cancel', { id: c.id }, clerk)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(await s.act('retail_closing.get', { id: c.id })).toMatchObject({ docstatus: DOCSTATUS.submitted });
    await s.act('retail_closing.cancel', { id: c.id }, { roles: ['sales', 'accounting'], actor: clerk.actor });
    expect(await s.act('retail_closing.get', { id: c.id })).toMatchObject({ docstatus: DOCSTATUS.cancelled });
    expect(await s.act('payment.get', { id: String(c.paymentId) })).toMatchObject({ docstatus: DOCSTATUS.cancelled });
    expect(await s.act('sales_invoice.get', { id: String(c.salesInvoiceId) })).toMatchObject({ docstatus: DOCSTATUS.cancelled, status: 'cancelled', paidAmount: '0' });
    expect((await s.act<Table>('inventory.stock_on_hand', { asOf: '2026-12-01' })).rows.find((r) => r.productCode === 'P3')?.qty).toBe('5');
    const dec = await s.act<Table>('accounting.trial_balance', { from: '2026-12-01', to: '2026-12-31' });
    for (const code of ['1000', '1300', '2200', '4000']) expect(dec.rows.find((r) => r.code === code)?.closingBalance, `${code} unchanged by the reversed entries`).toBe(code === '1000' ? '53730' : code === '1300' ? '8760' : code === '2200' ? '-5040' : '-57450');
    // lines of a submitted/cancelled closing are frozen
    await expect(s.act('retail_closing_line.create', { closingId: c.id, productId: product.P1, quantity: '1' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    // amend: a new draft with the same lines and amounts, links reset (left as a draft: nothing posts or moves)
    const amended = await s.act<ClosingJson>('retail_closing.amend', { id: c.id });
    expect(await s.act('retail_closing.get', { id: amended.id })).toMatchObject({ docstatus: DOCSTATUS.draft, amendedFrom: c.id, total: '1100', cashAmount: '1100', salesInvoiceId: null, paymentId: null });
  });

  it('AC-7 翌月 2026-12: Dr 5050 期首 7,700 / Cr 1400、Dr 1400 7,700 / Cr 5100（12 月は取引なし）; 古い月の締めと記録の直接作成は拒否', async () => {
    const closed = await s.act<Row>('retail.close_month', { period: '2026-12' });
    expect(closed).toMatchObject({ period: '2026-12', asOf: '2026-12-31', valuationTotal: '7700', openingAmount: '7700', alreadyClosed: false });
    expect(await entryLines(s, closed.journalEntryId)).toEqual([
      ['5050', '7700', '0'],
      ['1400', '0', '7700'],
      ['1400', '7700', '0'],
      ['5100', '0', '7700'],
    ]);
    await expect(s.act('retail.close_month', { period: '2026-10' })).rejects.toMatchObject({ code: 'INVALID_STATE', hint: expect.stringContaining('oldest first') });
    await expect(s.act('retail_month_close.create', { period: '2027-01', asOf: '2027-01-31', valuationTotal: '0' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(s.act('retail.close_month', { period: '2026-13' })).rejects.toMatchObject({ code: 'VALIDATION' });
    const sales = { roles: ['sales'], actor: { type: 'user' as const, id: s.db.adminUserId } };
    await expect(s.act('retail.close_month', { period: '2027-01' }, sales)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
