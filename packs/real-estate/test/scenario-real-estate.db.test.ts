// 台本 docs/domain/scenario-real-estate.md（架空「サンプルハイツ」2026-11）end to end, in script order, from pack:apply:
// every expected figure of the script is asserted here (invoices, journal lines, deposits, payments, trial balance, AR,
// 預り金, arrears, rent roll, 消費税集計表), then the post-script (退去・敷金返還) and the pack's guards.
// Test DB: daifuku_test_real_estate (TEST_DATABASE_URL_OWNER / TEST_DATABASE_URL). Runs in-process (runAction, repo).
import { DOCSTATUS, registerCrudActions, registerPackActions, registry } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RealEstatePack } from '../src/index.ts';
import { checkAfterScript, checkApply, checkExtAndDefaults, type ScriptState } from './scenario-checks.ts';
import { scenario, sum, type DocJson, type InvoiceJson, type ListJson, type Row, type Table } from './support.ts';

let db: TestDb;
const s = scenario(() => db);
const st: ScriptState = { acc: {}, unit: {}, tenant: {}, lease: {}, inv: {}, deposit: {} };
const idOf = (m: Record<string, string>, k: string): string => m[k] ?? `missing:${k}`;

beforeAll(async () => {
  registerCrudActions();
  registerPackActions();
  db = await freshDb();
});
afterAll(async () => {
  await db.close();
});

/** Invoice header + lines as the script's table: [date, dueDate, subtotal, tax, total, lines[description, qty, unitPrice, taxCategory]]. */
async function invoiceShape(id: string): Promise<[string, string | null, string, string, string, string[][]]> {
  const i = await s.act<InvoiceJson>('2026-12-31', 'sales_invoice.get', { id });
  return [i.date, i.dueDate, i.subtotal, i.taxTotal, i.total, i.lines.sales_invoice_line.map((l) => [l.description, l.quantity, l.unitPrice, l.taxCategory])];
}

describe('台本: 賃貸管理（自主管理）サンプルハイツ 2026-11 (docs/domain/scenario-real-estate.md)', () => {
  it('0. 準備: 会計年度 2026・モジュールのシード・pack:apply real_estate --sample（設定・科目・品目・物件/部屋/入居者/契約）、2 回目は何もしない', async () => {
    expect(registry.packs().map((p) => p.name)).toContain(RealEstatePack.name);
    await s.act('2026-11-01', 'accounting.open_fiscal_year', { startDate: '2026-01-01' });
    expect(await s.seedModules('2026-11-01')).toEqual(['partner', 'accounting', 'product', 'tax', 'l10n_jp']);
    await checkApply(s, st);
  });

  it('1. ext の検証・契約明細の税区分の既定（呼び出し側 > 品目 > 部屋の用途、1 か月未満の住宅は課税）・ラベルとメニュー', async () => {
    await checkExtAndDefaults(s, st);
  });

  it('2. 11-01 期首: 元入金 500,000 → Dr 1100 / Cr 3000、4 契約を確定（CTR-2026-000001..4、4 部屋とも occupied）', async () => {
    const je0 = await s.createSubmit<DocJson>('2026-11-01', 'journal_entry', { date: '2026-11-01', description: '元入金', lines: { journal_line: [{ accountId: st.acc['1100'], debit: '500000' }, { accountId: st.acc['3000'], credit: '500000' }] } });
    expect(await s.entryLines(je0.id)).toEqual([
      ['1100', '500000', '0'],
      ['3000', '0', '500000'],
    ]);
    for (const [i, t] of ['T1', 'T2', 'T3', 'T4'].entries()) {
      await s.act('2026-11-01', 'contract.submit', { id: idOf(st.lease, t) });
      const c = await s.act<DocJson & { status: string; nextPeriod: string }>('2026-11-01', 'contract.get', { id: idOf(st.lease, t) });
      expect(c, t).toMatchObject({ docstatus: DOCSTATUS.submitted, number: `CTR-2026-00000${i + 1}`, status: 'active' });
    }
    const units = await s.act<ListJson>('2026-11-01', 'real_estate_unit.list', { orderBy: [{ field: 'code', dir: 'asc' }] });
    expect(units.items.map((u) => [u.code, u.status])).toEqual([
      ['101', 'occupied'],
      ['102', 'occupied'],
      ['201', 'occupied'],
      ['P1', 'occupied'],
    ]);
  });

  it('3. 11-01 T1 の 11 月分（既存入居者、generate_invoices）と T3・T4 の入居（move_in）: 請求書・転記・敷金受領、T3 入金 220,000', async () => {
    const g = await s.act<{ created: { number: string; total: string; invoiceId: string }[] }>('2026-11-01', 'contract.generate_invoices', { period: '2026-11', contractId: st.lease.T1, submit: true });
    expect(g.created.map((c) => [c.number, c.total])).toEqual([['INV-2026-000001', '60000']]);
    st.inv.T1_11 = g.created[0]?.invoiceId ?? '';
    const t3 = await s.act<{ invoiceId: string; number: string; total: string; depositId?: string }>('2026-11-01', 'real_estate.move_in', { contractId: st.lease.T3, depositReceivedDate: '2026-11-01' });
    expect(t3).toMatchObject({ number: 'INV-2026-000002', total: '220000', depositId: expect.any(String) });
    const t4 = await s.act<{ invoiceId: string; number: string; total: string; depositId?: string }>('2026-11-01', 'real_estate.move_in', { contractId: st.lease.T4 });
    expect(t4).toEqual({ invoiceId: expect.any(String), number: 'INV-2026-000003', total: '8800' });
    Object.assign(st.inv, { T3_11: t3.invoiceId, T4_11: t4.invoiceId });
    st.deposit.T3 = t3.depositId ?? '';

    expect(await invoiceShape(st.inv.T1_11 ?? '')).toEqual(['2026-11-01', '2026-11-30', '60000', '0', '60000', [['家賃', '1', '60000', 'non_taxable']]]);
    expect(await invoiceShape(t3.invoiceId)).toEqual(['2026-11-01', '2026-11-30', '200000', '20000', '220000', [['家賃', '1', '100000', 'standard'], ['礼金', '1', '100000', 'standard']]]);
    expect(await invoiceShape(t4.invoiceId)).toEqual(['2026-11-01', '2026-11-30', '8000', '800', '8800', [['駐車場代', '1', '8000', 'standard']]]);
    const je = async (id: string) => s.entryLines((await s.act<InvoiceJson>('2026-12-31', 'sales_invoice.get', { id })).journalEntryId);
    expect(await je(st.inv.T1_11 ?? '')).toEqual([
      ['1300', '60000', '0'],
      ['4200', '0', '60000'],
    ]);
    expect(await je(t3.invoiceId)).toEqual([
      ['1300', '220000', '0'],
      ['4200', '0', '100000'],
      ['4200', '0', '100000'],
      ['2200', '0', '20000'],
    ]);
    expect(await je(t4.invoiceId)).toEqual([
      ['1300', '8800', '0'],
      ['4200', '0', '8000'],
      ['2200', '0', '800'],
    ]);
    const dep = await s.act<DocJson & Row>('2026-11-01', 'real_estate_deposit.get', { id: st.deposit.T3 });
    expect(dep).toMatchObject({ contractId: st.lease.T3, partnerId: st.tenant.T3, unitId: st.unit['201'], amount: '200000', receivedDate: '2026-11-01', returnedDate: null, returnedAmount: '0' });
    expect(await s.entryLines(dep.journalEntryId)).toEqual([
      ['1100', '200000', '0'],
      ['2500', '0', '200000'],
    ]);
    const p3 = await s.receive('2026-11-01', idOf(st.tenant, 'T3'), t3.invoiceId, '220000');
    expect(await s.entryLines(p3.journalEntryId)).toEqual([
      ['1100', '220000', '0'],
      ['1300', '0', '220000'],
    ]);
  });

  it('4. 11-05 T1 入金 60,000 → INV-2026-000001 paid', async () => {
    const p1 = await s.receive('2026-11-05', idOf(st.tenant, 'T1'), st.inv.T1_11 ?? '', '60000');
    expect(p1).toMatchObject({ docstatus: DOCSTATUS.submitted, accountId: st.acc['1100'], amount: '60000', allocatedAmount: '60000' });
    expect(await s.act('2026-11-05', 'sales_invoice.get', { id: st.inv.T1_11 })).toMatchObject({ status: 'paid', balance: '0' });
  });

  it('5. 11-10 T2 入居（11-11 開始・日割り 20/30）: 家賃 43,333 + 礼金 65,000 = 108,333（非課税、請求日は 11-01）、敷金 65,000 受領、同日入金', async () => {
    const t2 = await s.act<{ invoiceId: string; number: string; total: string; depositId?: string }>('2026-11-10', 'real_estate.move_in', { contractId: st.lease.T2, depositReceivedDate: '2026-11-10' });
    expect(t2).toMatchObject({ number: 'INV-2026-000004', total: '108333', depositId: expect.any(String) });
    st.inv.T2_11 = t2.invoiceId;
    st.deposit.T2 = t2.depositId ?? '';
    expect(await invoiceShape(t2.invoiceId)).toEqual(['2026-11-01', '2026-11-30', '108333', '0', '108333', [['家賃', '1', '43333', 'non_taxable'], ['礼金', '1', '65000', 'non_taxable']]]);
    const inv = await s.act<InvoiceJson & { taxSummary: Row[] }>('2026-11-10', 'sales_invoice.get', { id: t2.invoiceId });
    expect(inv.taxSummary).toMatchObject([{ category: 'non_taxable', taxable: '108333', tax: '0', gross: '108333', lineCount: 2 }]);
    expect(await s.entryLines(inv.journalEntryId)).toEqual([
      ['1300', '108333', '0'],
      ['4200', '0', '43333'],
      ['4200', '0', '65000'],
    ]);
    const dep = await s.act<DocJson & Row>('2026-11-10', 'real_estate_deposit.get', { id: st.deposit.T2 });
    expect(dep).toMatchObject({ amount: '65000', receivedDate: '2026-11-10' });
    expect(await s.entryLines(dep.journalEntryId)).toEqual([
      ['1100', '65000', '0'],
      ['2500', '0', '65000'],
    ]);
    await s.receive('2026-11-10', idOf(st.tenant, 'T2'), t2.invoiceId, '108333');
    expect(await s.act('2026-11-10', 'sales_invoice.get', { id: t2.invoiceId })).toMatchObject({ status: 'paid', balance: '0' });
  });

  it('6. 11-25 12 月分を一括生成・確定: 請求日 12-01・期日 12-31（T1 60,000 / T2 65,000 / T3 110,000 / T4 8,800）', async () => {
    const g = await s.act<{ created: { contractId: string; invoiceId: string; number: string; total: string }[]; skipped: Row[] }>('2026-11-25', 'contract.generate_invoices', { period: '2026-12', submit: true });
    expect(g.created.map((c) => [c.contractId, c.number, c.total])).toEqual([
      [st.lease.T1, 'INV-2026-000005', '60000'],
      [st.lease.T2, 'INV-2026-000006', '65000'],
      [st.lease.T3, 'INV-2026-000007', '110000'],
      [st.lease.T4, 'INV-2026-000008', '8800'],
    ]);
    expect(g.skipped).toEqual([]);
    for (const c of g.created) {
      const [date, due] = await invoiceShape(c.invoiceId);
      expect([date, due], c.number).toEqual(['2026-12-01', '2026-12-31']);
    }
    st.inv.T4_12 = g.created[3]?.invoiceId ?? '';
    // 制限（台本 §制限 2）: T1 は 2026-04 開始の既存契約。導入前の 4〜10 月を「請求済み」にする手段が無く、nextPeriod は 2026-04 のまま・
    // contract.schedule では 5 月も due に出る（contract_billing は generate_invoices しか書けない）
    const next = async (t: string) => (await s.act<Row>('2026-11-25', 'contract.get', { id: idOf(st.lease, t) })).nextPeriod;
    expect([await next('T1'), await next('T2'), await next('T3'), await next('T4')]).toEqual(['2026-04', '2027-01', '2027-01', '2027-01']);
    const may = await s.act<Table>('2026-11-25', 'contract.schedule', { period: '2026-05' });
    expect(may.rows.filter((r) => r.status === 'due').map((r) => r.contractId)).toEqual([st.lease.T1]);
  });

  it('7. 期待値 試算表 11/01〜11/30（合計 1,550,466）と 11/01〜12/05（12 月分を含む、合計 1,794,266）', async () => {
    const tb = async (to: string) => s.act<Table>('2026-12-05', 'accounting.trial_balance', { from: '2026-11-01', to });
    const nov: Record<string, [string, string, string]> = {
      '1100': ['1153333', '0', '1153333'],
      '1300': ['397133', '388333', '8800'],
      '2200': ['0', '20800', '-20800'],
      '2500': ['0', '265000', '-265000'],
      '3000': ['0', '500000', '-500000'],
      '4200': ['0', '376333', '-376333'],
    };
    const dec5 = { ...nov, '1300': ['640933', '388333', '252600'], '2200': ['0', '31600', '-31600'], '4200': ['0', '609333', '-609333'] } as Record<string, [string, string, string]>;
    for (const [to, expected, total] of [['2026-11-30', nov, '1550466'], ['2026-12-05', dec5, '1794266']] as const) {
      const t = await tb(to);
      for (const r of t.rows) {
        const want = expected[String(r.code)] ?? ['0', '0', '0'];
        expect.soft([r.periodDebit, r.periodCredit, r.closingBalance], `${to} ${String(r.code)} ${String(r.name)}`).toEqual(want);
      }
      expect(t.totals).toMatchObject({ periodDebit: total, periodCredit: total, closingBalance: '0' });
    }
  });

  it('8. 売掛金（11-30: 8,800、12-05: 252,600）・預り金 265,000（敷金台帳と一致）・売掛金年齢表 12-05', async () => {
    const open = async (asOf: string) => {
      const l = await s.act<ListJson>(asOf, 'sales_invoice.list', { where: { docstatus: DOCSTATUS.submitted, status: 'open', date: { $lte: asOf } }, limit: 100 });
      return sum(l.items.map((i) => String(i.balance)));
    };
    expect(await open('2026-11-30')).toBe('8800');
    expect(await open('2026-12-05')).toBe('252600');
    const deposits = await s.act<ListJson>('2026-12-05', 'real_estate_deposit.list', { where: { returnedDate: null }, limit: 100 });
    expect(sum(deposits.items.map((d) => String(d.amount)))).toBe('265000');
    const aging = await s.act<Table>('2026-12-05', 'sales.ar_aging', { asOf: '2026-12-05' });
    expect(aging.totals).toEqual({ notDue: '243800', days1to30: '8800', days31to60: '0', days61to90: '0', over90: '0', total: '252600' });
    expect(aging.rows.find((r) => r.partnerId === st.tenant.T4)).toMatchObject({ notDue: '8800', days1to30: '8800', total: '17600' });
  });

  it('9. 滞納一覧 asOf 12-05: T4 の 11 月分 8,800（期日 11-30、延滞 5 日）だけ。11-30 は期日当日で 0 件、2027-01-01 は 12 月分も 1 日遅れ', async () => {
    const t = await s.act<Table>('2026-12-05', 'real_estate.arrears', { asOf: '2026-12-05' });
    expect(t.rows).toEqual([
      { tenantName: '江藤 次郎', propertyName: 'サンプルハイツ', unitCode: 'P1', period: '2026-11', invoiceNumber: 'INV-2026-000003', dueDate: '2026-11-30', daysOverdue: 5, balance: '8800', invoiceId: st.inv.T4_11, contractId: st.lease.T4, partnerId: st.tenant.T4, unitId: st.unit.P1 },
    ]);
    expect(t.totals).toEqual({ balance: '8800' });
    expect(t.meta).toMatchObject({ asOf: '2026-12-05', count: 1 });
    expect((await s.act<Table>('2026-12-05', 'real_estate.arrears', { asOf: '2026-11-30' })).rows).toEqual([]);
    const jan = await s.act<Table>('2026-12-05', 'real_estate.arrears', { asOf: '2027-01-01' });
    expect(jan.rows.map((r) => [r.unitCode, r.period, r.daysOverdue, r.balance])).toEqual([
      ['101', '2026-12', 1, '60000'],
      ['102', '2026-12', 1, '65000'],
      ['201', '2026-12', 1, '110000'],
      ['P1', '2026-11', 32, '8800'],
      ['P1', '2026-12', 1, '8800'],
    ]);
    expect(jan.totals).toEqual({ balance: '252600' });
  });

  it('10. レントロール asOf 11-30: 4 戸 occupied、月額 233,000（課税 108,000 / 非課税 125,000）', async () => {
    const t = await s.act<Table>('2026-11-30', 'real_estate.rent_roll', { asOf: '2026-11-30' });
    expect(t.rows.map((r) => [r.propertyName, r.unitCode, r.usage, r.floorArea, r.monthlyRent, r.tenantName, r.startDate, r.endDate, r.status, r.taxCategory])).toEqual([
      ['サンプルハイツ', '101', 'residential', '25.5', '60000', '青木 一郎', '2026-04-01', null, 'occupied', 'non_taxable'],
      ['サンプルハイツ', '102', 'residential', '28', '65000', '井上 花子', '2026-11-11', null, 'occupied', 'non_taxable'],
      ['サンプルハイツ', '201', 'office', '42.25', '100000', '株式会社ウエスト企画', '2026-11-01', null, 'occupied', 'standard'],
      ['サンプルハイツ', 'P1', 'parking', null, '8000', '江藤 次郎', '2026-11-01', null, 'occupied', 'standard'],
    ]);
    expect(t.totals).toEqual({ monthlyRent: '233000', taxableRent: '108000', nonTaxableRent: '125000' });
    expect(t.meta).toMatchObject({ asOf: '2026-11-30', counts: { vacant: 0, occupied: 4 } });
  });

  it('11. 消費税集計表: 11 月 課税売上 208,000 / 税 20,800・非課税売上 168,333（12 月分は請求日 12-01 なので 12 月: 108,000 / 10,800・125,000）', async () => {
    const summary = async (from: string, to: string) => {
      const t = await s.act<Table>('2026-12-31', 'accounting.tax_period_summary', { from, to });
      return { rows: t.rows.map((r) => [r.side, r.taxCategory, r.taxRate, r.taxableAmount, r.taxAmount, r.count]), totals: t.totals };
    };
    expect(await summary('2026-11-01', '2026-11-30')).toEqual({
      rows: [
        ['売上', 'standard', '0.10', '208000', '20800', 5],
        ['売上', 'non_taxable', '0.00', '168333', '0', 3],
      ],
      totals: { output_tax_total: '20800', input_tax_total: '0', net_tax_due: '20800' },
    });
    expect(await summary('2026-12-01', '2026-12-31')).toEqual({
      rows: [
        ['売上', 'standard', '0.10', '108000', '10800', 4],
        ['売上', 'non_taxable', '0.00', '125000', '0', 2],
      ],
      totals: { output_tax_total: '10800', input_tax_total: '0', net_tax_due: '10800' },
    });
  });

  it('12. 台本の後: T2 退去（終了日 12-31、12-25 に登録 → occupied のまま、2027-01-04 に再実行 → vacant・ended）、敷金返還 65,000（控除 22,000）、各種ガード', async () => {
    await checkAfterScript(s, st);
  });
});
