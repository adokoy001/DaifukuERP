// Postgres tests for docs/specs/inventory.md AC-1..AC-4, AC-6..AC-9, AC-11 (the invoice hooks of AC-5 are in
// invoices.db.test.ts). Test DB: daifuku_test_inventory. Fixture: test/fixture.ts. Tests run in order and share the DB;
// each scenario uses its own products so balances do not interfere.
import {
  Decimal,
  DependencyError,
  DOCSTATUS,
  PermissionDenied,
  registry,
  repo,
  setSetting,
  StateError,
  ValidationError,
  type Context,
  type ContextParams,
  type Infer,
} from '@daifuku/kernel';
import { Product } from '@daifuku/mod-product';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALLOW_NEGATIVE_STOCK_KEY,
  AUTO_ISSUE_ON_SALES_KEY,
  AUTO_RECEIPT_ON_PURCHASE_KEY,
  boolSettingSchema,
  DEFAULT_WAREHOUSE_KEY,
  INVENTORY_SETTING_DEFAULTS,
  InventoryModule,
  LEDGER_WRITE_HINT,
  loadBalance,
  resolveDefaultWarehouse,
  SERVICE_HINT,
  StockBalance,
  StockEntry,
  StockEntryLine,
  StockLedger,
  Warehouse,
} from '../src/index.ts';
import {
  asRole,
  caught,
  issuesOf,
  setupFixture,
  type EntryJson,
  type EntryWithLines,
  type Fixture,
  type Row,
  type Table,
} from './fixture.ts';
import { golden, type GoldenStep } from './golden.ts';

let fx: Fixture;
const clerk = asRole(['inventory', 'viewer']);
const admin: Partial<ContextParams> = {};

const createEntry = async (params: Partial<ContextParams>, head: Row, lines: Row[]): Promise<EntryWithLines> => {
  const created = await fx.act<EntryJson>(params, 'stock_entry.create', {
    ...head,
    lines: { stock_entry_line: lines },
  });
  return fx.act<EntryWithLines>(params, 'stock_entry.get', { id: created.id });
};
const getEntry = (id: string) => fx.act<EntryWithLines>(admin, 'stock_entry.get', { id });
const submitEntry = (params: Partial<ContextParams>, id: string) =>
  fx.act<EntryJson>(params, 'stock_entry.submit', { id });
const cancelEntry = (params: Partial<ContextParams>, id: string, correctionDate?: string) =>
  fx.act<EntryJson>(params, 'stock_entry.cancel', { id, ...(correctionDate ? { correctionDate } : {}) });
const post = async (head: Row, lines: Row[]): Promise<EntryWithLines> => {
  const e = await createEntry(clerk, head, lines);
  await submitEntry(clerk, e.id);
  return getEntry(e.id);
};
const balanceOf = (productId: string, warehouseId: string) =>
  fx.run(admin, async (ctx) => {
    const b = await loadBalance(ctx, { productId, warehouseId });
    return b ? [b.qty.toString(), b.avgCost.toString(), b.value.toString(), b.lastSeq] : null;
  });
type LedgerView = {
  seq: number;
  qtyDelta: string;
  unitCost: string;
  costDelta: string;
  balanceQty: string;
  balanceCost: string;
  reversal: boolean;
  sourceId: string;
  date: string;
};
const ledgerOf = (productId: string, warehouseId: string): Promise<LedgerView[]> =>
  fx.run(admin, async (ctx) => {
    const rows = await repo(ctx, StockLedger).list({
      where: { productId, warehouseId },
      orderBy: [{ field: 'seq', dir: 'asc' }],
      limit: 500,
    });
    return rows.items.map((r) => ({
      seq: r.seq,
      qtyDelta: r.qtyDelta.toString(),
      unitCost: r.unitCost.toString(),
      costDelta: r.costDelta.toString(),
      balanceQty: r.balanceQty.toString(),
      balanceCost: r.balanceCost.toString(),
      reversal: r.reversal,
      sourceId: r.sourceId,
      date: r.date,
    }));
  });
const newProduct = (code: string, extra: Row = {}) =>
  fx.run(
    admin,
    async (ctx) =>
      (await repo(ctx, Product).create({ code, name: `品目${code}`, taxCategory: 'standard', ...extra })).id,
  );
const setBool = (key: string, value: boolean) => fx.run(admin, (ctx) => setSetting(ctx, key, boolSettingSchema, value));

beforeAll(async () => {
  fx = await setupFixture();
});
afterAll(async () => {
  await fx.db.close();
});

describe('inventory module (docs/specs/inventory.md)', () => {
  it('AC-1 / AC-8 entities, MAIN seed (idempotent), one default warehouse, settings with defaults', async () => {
    expect(InventoryModule.entities.map((e) => e.name)).toEqual([
      'inventory_period_close',
      'warehouse',
      'stock_ledger',
      'stock_balance',
      'stock_entry',
      'stock_entry_line',
      'stock_count',
      'stock_count_line',
    ]);
    expect(StockEntry.kind).toBe('document');
    const list = () => fx.act<{ items: Row[] }>(admin, 'warehouse.list', { orderBy: [{ field: 'code', dir: 'asc' }] });
    expect((await list()).items.map((w) => [w.code, w.name, w.isDefault])).toEqual([
      ['MAIN', '本店（主倉庫）', true],
      ['SUB', '第二倉庫', false],
    ]);
    await fx.act(admin, 'warehouse.update', { id: fx.wh.sub, patch: { isDefault: true } });
    expect((await list()).items.map((w) => [w.code, w.isDefault])).toEqual([
      ['MAIN', false],
      ['SUB', true],
    ]);
    await fx.act(clerk, 'warehouse.update', { id: fx.wh.main, patch: { isDefault: true } });
    expect((await list()).items.map((w) => [w.code, w.isDefault])).toEqual([
      ['MAIN', true],
      ['SUB', false],
    ]);
    expect(await caught(fx.act(admin, 'warehouse.create', { code: 'main', name: 'dup' }))).toMatchObject({
      code: 'CONFLICT',
    });
    for (const key of [
      ALLOW_NEGATIVE_STOCK_KEY,
      AUTO_RECEIPT_ON_PURCHASE_KEY,
      AUTO_ISSUE_ON_SALES_KEY,
      DEFAULT_WAREHOUSE_KEY,
    ])
      expect(registry.hasSetting(key)).toBe(true);
    expect(INVENTORY_SETTING_DEFAULTS).toEqual({
      [ALLOW_NEGATIVE_STOCK_KEY]: false,
      [AUTO_RECEIPT_ON_PURCHASE_KEY]: true,
      [AUTO_ISSUE_ON_SALES_KEY]: true,
      [DEFAULT_WAREHOUSE_KEY]: 'MAIN',
    });
    expect((await fx.run(admin, (ctx) => resolveDefaultWarehouse(ctx))).id).toBe(fx.wh.main);
  });

  it('AC-2 stock_entry + lines: defaults, system-owned source, computed amount, line and header rules (service → VALIDATION with hint)', async () => {
    const e = await createEntry(clerk, { type: 'receipt', sourceEntity: 'purchase_invoice', sourceId: fx.wh.main }, [
      { productId: fx.product.a, quantity: '10', unitCost: '100.5' },
    ]);
    expect(e).toMatchObject({
      docstatus: 0,
      number: null,
      type: 'receipt',
      date: '2026-09-10',
      warehouseId: fx.wh.main,
      toWarehouseId: null,
      sourceEntity: null,
      sourceId: null,
    });
    expect(e.lines.stock_entry_line.map((l) => [l.seq, l.productId, l.quantity, l.sign, l.unitCost, l.amount])).toEqual(
      [[1, fx.product.a, '10', null, '100.5', '1005']],
    );
    const service = await caught(
      createEntry(clerk, { type: 'receipt' }, [{ productId: fx.product.svc, quantity: '1', unitCost: '1' }]),
    );
    expect(service).toBeInstanceOf(ValidationError);
    expect((service as ValidationError).hint).toBe(SERVICE_HINT);
    expect(issuesOf(service)).toEqual(['productId']);
    expect(
      issuesOf(
        await caught(
          createEntry(clerk, { type: 'receipt' }, [{ productId: fx.product.a, quantity: '0', unitCost: '1' }]),
        ),
      ),
    ).toEqual(['quantity']);
    expect(
      issuesOf(
        await caught(
          createEntry(clerk, { type: 'receipt' }, [{ productId: fx.product.a, quantity: '1.0000001', unitCost: '1' }]),
        ),
      ),
    ).toEqual(['quantity']);
    expect(
      issuesOf(await caught(createEntry(clerk, { type: 'receipt' }, [{ productId: fx.product.a, quantity: '1' }]))),
    ).toEqual(['unitCost']);
    expect(
      issuesOf(
        await caught(
          createEntry(clerk, { type: 'receipt' }, [
            { productId: fx.product.a, quantity: '1', unitCost: '1', sign: 'in' },
          ]),
        ),
      ),
    ).toEqual(['sign']);
    expect(
      issuesOf(await caught(createEntry(clerk, { type: 'adjustment' }, [{ productId: fx.product.a, quantity: '1' }]))),
    ).toEqual(['sign']);
    expect(
      issuesOf(
        await caught(
          createEntry(clerk, { type: 'adjustment' }, [{ productId: fx.product.a, quantity: '1', sign: 'in' }]),
        ),
      ),
    ).toEqual(['unitCost']);
    // outbound lines drop a sent unit cost: it is computed at submit
    const issue = await createEntry(clerk, { type: 'issue' }, [
      { productId: fx.product.a, quantity: '2', unitCost: '999' },
    ]);
    expect(issue.lines.stock_entry_line.map((l) => [l.unitCost, l.amount])).toEqual([[null, '0']]);
    const out = await createEntry(clerk, { type: 'adjustment' }, [
      { productId: fx.product.a, quantity: '1', sign: 'out', unitCost: '5' },
    ]);
    expect(out.lines.stock_entry_line.map((l) => [l.sign, l.unitCost, l.amount])).toEqual([['out', null, '0']]);
    // header
    expect(issuesOf(await caught(createEntry(clerk, { type: 'receipt', toWarehouseId: fx.wh.sub }, [])))).toEqual([
      'toWarehouseId',
    ]);
    expect(
      issuesOf(
        await caught(createEntry(clerk, { type: 'transfer', warehouseId: fx.wh.sub, toWarehouseId: fx.wh.sub }, [])),
      ),
    ).toEqual(['toWarehouseId']);
    expect(await caught(fx.act(clerk, 'stock_entry.create', { type: 'bogus' }))).toBeInstanceOf(ValidationError);
    const empty = await createEntry(clerk, { type: 'issue' }, []);
    expect(issuesOf(await caught(submitEntry(clerk, empty.id)))).toEqual(['lines']);
    const transfer = await createEntry(clerk, { type: 'transfer' }, [{ productId: fx.product.a, quantity: '1' }]);
    expect(issuesOf(await caught(submitEntry(clerk, transfer.id)))).toEqual(['toWarehouseId']);
    // a patch cannot set the source link; the type change is re-validated at submit
    await fx.act(clerk, 'stock_entry.update', {
      id: e.id,
      patch: { sourceEntity: 'sales_invoice', sourceId: e.id, type: 'issue' },
    });
    expect(await getEntry(e.id)).toMatchObject({ type: 'issue', sourceEntity: null, sourceId: null });
    // the stored line passes as an issue line (its unitCost is ignored and recomputed); product A has no stock yet
    expect(await caught(submitEntry(clerk, e.id))).toBeInstanceOf(StateError);
    expect((await getEntry(e.id)).docstatus).toBe(DOCSTATUS.draft);
  });

  it('AC-3 receipt / issue / transfer / adjustment post the moving average to stock_ledger and stock_balance', async () => {
    const p = await newProduct('P3');
    const r = await post({ type: 'receipt', date: '2026-09-01' }, [
      { productId: p, quantity: '10', unitCost: '100' },
      { productId: p, quantity: '10', unitCost: '120' },
    ]);
    expect(r).toMatchObject({ docstatus: 1, type: 'receipt' });
    expect(r.number).toMatch(/^STK-2026-\d{6}$/);
    const rows = await ledgerOf(p, fx.wh.main);
    expect(
      rows.map((l) => [l.seq, l.qtyDelta, l.unitCost, l.costDelta, l.balanceQty, l.balanceCost, l.reversal, l.date]),
    ).toEqual([
      [1, '10', '100', '1000', '10', '1000', false, '2026-09-01'],
      [2, '10', '110', '1200', '20', '2200', false, '2026-09-01'],
    ]);
    expect(rows.every((l) => l.sourceId === r.id)).toBe(true);
    const raw = await fx.run(
      admin,
      async (ctx) => (await repo(ctx, StockLedger).list({ where: { productId: p }, limit: 1 })).items[0],
    );
    expect(raw?.sourceEntity).toBe('stock_entry');
    expect(await balanceOf(p, fx.wh.main)).toEqual(['20', '110', '2200', 2]);
    expect(r.lines.stock_entry_line.map((l) => [l.unitCost, l.amount])).toEqual([
      ['100', '1000'],
      ['120', '1200'],
    ]);

    const i = await post({ type: 'issue', date: '2026-09-02' }, [{ productId: p, quantity: '5' }]);
    expect(i.lines.stock_entry_line.map((l) => [l.unitCost, l.amount])).toEqual([['110', '550']]);
    expect(await balanceOf(p, fx.wh.main)).toEqual(['15', '110', '1650', 3]);

    const t = await post({ type: 'transfer', date: '2026-09-03', toWarehouseId: fx.wh.sub }, [
      { productId: p, quantity: '3' },
    ]);
    expect(t.lines.stock_entry_line.map((l) => [l.unitCost, l.amount])).toEqual([['110', '330']]);
    expect(await balanceOf(p, fx.wh.main)).toEqual(['12', '110', '1320', 4]);
    expect(await balanceOf(p, fx.wh.sub)).toEqual(['3', '110', '330', 1]);
    expect((await ledgerOf(p, fx.wh.sub)).map((l) => [l.seq, l.qtyDelta, l.unitCost, l.costDelta, l.sourceId])).toEqual(
      [[1, '3', '110', '330', t.id]],
    );

    const a = await post({ type: 'adjustment', date: '2026-09-04' }, [
      { productId: p, quantity: '2', sign: 'in', unitCost: '95' },
      { productId: p, quantity: '1', sign: 'out' },
    ]);
    // in: (1320 + 190) / 14 = 107.857142857… → 107.857143; out: 1 × 107.857143
    expect(a.lines.stock_entry_line.map((l) => [l.sign, l.unitCost, l.amount])).toEqual([
      ['in', '95', '190'],
      ['out', '107.857143', '107.857143'],
    ]);
    expect(await balanceOf(p, fx.wh.main)).toEqual(['13', '107.857143', '1402.142857', 6]);
    // value across warehouses = 2200 − 550 + 190 − 107.857143: the transfer moved value without creating or losing any
    const values = [(await balanceOf(p, fx.wh.main))?.[2], (await balanceOf(p, fx.wh.sub))?.[2]].map((v) =>
      Decimal.from(String(v)),
    );
    expect(Decimal.sum(values).toString()).toBe(
      Decimal.from('2200').minus('550').plus('190').minus('107.857143').toString(),
    );
  });

  it('AC-3 negative stock is refused with the available quantity (nothing posted, entry stays a draft) unless inventory.allow_negative_stock', async () => {
    const p = await newProduct('NEG');
    const e = await createEntry(clerk, { type: 'issue' }, [{ productId: p, quantity: '4' }]);
    const err = await caught(submitEntry(clerk, e.id));
    expect(err).toBeInstanceOf(StateError);
    expect((err as StateError).hint).toContain('Available quantity is 0');
    expect((err as StateError).details).toMatchObject({
      productId: p,
      warehouseId: fx.wh.main,
      available: '0',
      requested: '4',
      reversal: false,
    });
    expect((err as StateError).message).toContain('product NEG in warehouse MAIN');
    expect((await getEntry(e.id)).docstatus).toBe(DOCSTATUS.draft);
    expect(await ledgerOf(p, fx.wh.main)).toEqual([]);
    expect(await balanceOf(p, fx.wh.main)).toBeNull();

    await setBool(ALLOW_NEGATIVE_STOCK_KEY, true);
    await submitEntry(clerk, e.id);
    expect(await balanceOf(p, fx.wh.main)).toEqual(['-4', '0', '0', 1]);
    await post({ type: 'receipt' }, [{ productId: p, quantity: '10', unitCost: '50' }]);
    expect(await balanceOf(p, fx.wh.main)).toEqual(['6', '50', '300', 2]);
    await setBool(ALLOW_NEGATIVE_STOCK_KEY, false);

    // the second line of the same entry runs short: the whole submit rolls back
    const two = await createEntry(clerk, { type: 'issue' }, [
      { productId: p, quantity: '5' },
      { productId: p, quantity: '5' },
    ]);
    const short = await caught(submitEntry(clerk, two.id));
    expect((short as StateError).details).toMatchObject({ available: '1', requested: '5' });
    expect(await balanceOf(p, fx.wh.main)).toEqual(['6', '50', '300', 2]);
    expect(await ledgerOf(p, fx.wh.main)).toHaveLength(2);
  });

  it('AC-11 golden replayed through stock entries: the ledger rows equal test/golden/moving-average.json (cancel steps = stock_entry.cancel)', async () => {
    let n = 0;
    for (const scenario of golden.scenarios) {
      const p = await newProduct(`G${++n}`);
      await setBool(ALLOW_NEGATIVE_STOCK_KEY, scenario.allowNegative);
      const posted: { step: GoldenStep; id: string; cancelled: boolean }[] = [];
      for (const [k, step] of scenario.steps.entries()) {
        const date = `2026-08-${String(k + 1).padStart(2, '0')}`;
        if (step.op === 'receipt' || step.op === 'issue') {
          const lines = [
            { productId: p, quantity: step.qty, ...(step.op === 'receipt' ? { unitCost: step.unitCost } : {}) },
          ];
          posted.push({ step, id: (await post({ type: step.op, date }, lines)).id, cancelled: false });
          continue;
        }
        const origOp = step.op === 'reverse_receipt' ? 'receipt' : 'issue';
        const target = [...posted]
          .reverse()
          .find(
            (x) =>
              !x.cancelled &&
              x.step.op === origOp &&
              x.step.qty === step.qty &&
              Decimal.from(x.step.expect.costDelta).abs().eq(step.totalCost),
          );
        if (!target) throw new TypeError(`golden step ${k} has no entry to cancel`);
        await cancelEntry(clerk, target.id, date);
        target.cancelled = true;
      }
      const rows = await ledgerOf(p, fx.wh.main);
      expect(
        rows.map(({ qtyDelta, costDelta, unitCost, balanceQty, balanceCost }) => ({
          qtyDelta,
          costDelta,
          unitCost,
          balanceQty,
          balanceCost,
        })),
        scenario.name,
      ).toEqual(scenario.steps.map((s) => s.expect));
      const last = scenario.steps.at(-1)?.expect;
      expect((await balanceOf(p, fx.wh.main))?.slice(0, 3)).toEqual([
        last?.balanceQty,
        last?.unitCost,
        last?.balanceCost,
      ]);
    }
    await setBool(ALLOW_NEGATIVE_STOCK_KEY, false);
  });

  it('AC-4 cancel appends reverse rows (never deletes), restores balances, refuses to go negative; cancelled entries are read-only; amend', async () => {
    const p = await newProduct('CAN');
    const e1 = await post({ type: 'receipt', date: '2026-09-05' }, [{ productId: p, quantity: '10', unitCost: '100' }]);
    const e2 = await post({ type: 'issue', date: '2026-09-06' }, [{ productId: p, quantity: '4' }]);
    const before = await ledgerOf(p, fx.wh.main);
    const cancelled = await cancelEntry(clerk, e2.id);
    expect(cancelled.docstatus).toBe(DOCSTATUS.cancelled);
    const after = await ledgerOf(p, fx.wh.main);
    expect(after.slice(0, 2)).toEqual(before);
    expect(after[2]).toMatchObject({
      seq: 3,
      qtyDelta: '4',
      costDelta: '400',
      unitCost: '100',
      balanceQty: '10',
      balanceCost: '1000',
      reversal: true,
      sourceId: e2.id,
      date: '2026-09-06',
    });
    expect(await balanceOf(p, fx.wh.main)).toEqual(['10', '100', '1000', 3]);

    const e3 = await post({ type: 'issue', date: '2026-09-07' }, [{ productId: p, quantity: '8' }]);
    const refused = await caught(cancelEntry(clerk, e1.id, '2026-09-07'));
    expect(refused).toBeInstanceOf(StateError);
    expect((refused as StateError).details).toMatchObject({ available: '2', requested: '10', reversal: true });
    expect((await getEntry(e1.id)).docstatus).toBe(DOCSTATUS.submitted);
    expect(await ledgerOf(p, fx.wh.main)).toHaveLength(4);
    await cancelEntry(clerk, e3.id);
    await cancelEntry(clerk, e1.id, '2026-09-07');
    expect(await balanceOf(p, fx.wh.main)).toEqual(['0', '100', '0', 6]);
    expect(await caught(cancelEntry(clerk, e1.id, '2026-09-07'))).toBeInstanceOf(StateError);

    // read-only after cancel / submit; lines frozen on every path
    expect(await caught(fx.act(clerk, 'stock_entry.update', { id: e1.id, patch: { note: 'x' } }))).toBeInstanceOf(
      StateError,
    );
    expect(await caught(fx.act(clerk, 'stock_entry.delete', { id: e1.id }))).toBeInstanceOf(StateError);
    const lineId = e1.lines.stock_entry_line[0]?.id ?? '';
    const frozen = await caught(fx.act(clerk, 'stock_entry_line.update', { id: lineId, patch: { quantity: '1' } }));
    expect(frozen).toBeInstanceOf(StateError);
    expect((frozen as StateError).hint).toBe('Use the owning module operation, or cancel and amend.');
    expect(await caught(fx.act(clerk, 'stock_entry_line.delete', { id: lineId }))).toBeInstanceOf(StateError);
    expect(
      await caught(
        fx.act(clerk, 'stock_entry_line.create', { entryId: e1.id, productId: p, quantity: '1', unitCost: '1' }),
      ),
    ).toBeInstanceOf(StateError);

    const amended = await fx.act<EntryJson>(clerk, 'stock_entry.amend', { id: e1.id });
    expect(amended).toMatchObject({ docstatus: 0, amendedFrom: e1.id, type: 'receipt', sourceEntity: null });
    expect((await getEntry(amended.id)).lines.stock_entry_line.map((l) => [l.quantity, l.unitCost])).toEqual([
      ['10', '100'],
    ]);
    await fx.act(clerk, 'stock_entry.update', { id: amended.id, patch: { date: '2026-09-07' } });
    expect((await submitEntry(clerk, amended.id)).number).toBe(`${e1.number ?? ''}-1`);
    expect(await balanceOf(p, fx.wh.main)).toEqual(['10', '100', '1000', 7]);
  });

  it('AC-6 stock count: systemQty on save, adjustment entry for the variances at submit, count_variance, cancel', async () => {
    const [pa, pb, pc] = [await newProduct('CA'), await newProduct('CB'), await newProduct('CC')];
    await post({ type: 'receipt', date: '2026-09-08' }, [
      { productId: pa, quantity: '10', unitCost: '100' },
      { productId: pb, quantity: '5', unitCost: '20' },
    ]);
    const created = await fx.act<Row & { id: string }>(clerk, 'stock_count.create', {
      lines: {
        stock_count_line: [
          { productId: pa, countedQty: '8' },
          { productId: pb, countedQty: '5' },
          { productId: pc, countedQty: '3' },
        ],
      },
    });
    const draft = await fx.act<Row & { lines: { stock_count_line: Row[] } }>(clerk, 'stock_count.get', {
      id: created.id,
    });
    expect(draft).toMatchObject({ docstatus: 0, warehouseId: fx.wh.main, date: '2026-09-10', adjustmentEntryId: null });
    expect(draft.lines.stock_count_line.map((l) => [l.systemQty, l.countedQty, l.varianceQty])).toEqual([
      ['10', '8', '-2'],
      ['5', '5', '0'],
      ['0', '3', '3'],
    ]);
    expect(
      issuesOf(
        await caught(
          fx.act(clerk, 'stock_count_line.create', { countId: created.id, productId: fx.product.svc, countedQty: '1' }),
        ),
      ),
    ).toEqual(['productId']);
    expect(
      await caught(fx.act(clerk, 'stock_count_line.create', { countId: created.id, productId: pa, countedQty: '-1' })),
    ).toBeInstanceOf(ValidationError);

    const live = await fx.act<Table>(clerk, 'inventory.count_variance', { countId: created.id });
    expect(
      live.rows.map((r) => [
        r.seq,
        r.productCode,
        r.systemQty,
        r.countedQty,
        r.varianceQty,
        r.unitCost,
        r.varianceValue,
      ]),
    ).toEqual([
      [1, 'CA', '10', '8', '-2', '100', '-200'],
      [2, 'CB', '5', '5', '0', '20', '0'],
      [3, 'CC', '0', '3', '3', '0', '0'],
    ]);
    expect(live.totals).toEqual({ varianceValue: '-200' });
    expect(live.meta).toMatchObject({ live: true, docstatus: 0 });

    // stock moves between saving and submitting: submit re-reads the system quantity
    await post({ type: 'issue', date: '2026-09-09' }, [{ productId: pa, quantity: '1' }]);
    const submitted = await fx.act<Row & { number: string; adjustmentEntryId: string }>(clerk, 'stock_count.submit', {
      id: created.id,
    });
    expect(submitted.number).toMatch(/^CNT-2026-\d{6}$/);
    const count = await fx.act<Row & { adjustmentEntryId: string; lines: { stock_count_line: Row[] } }>(
      clerk,
      'stock_count.get',
      { id: created.id },
    );
    expect(count.lines.stock_count_line.map((l) => [l.systemQty, l.varianceQty])).toEqual([
      ['9', '-1'],
      ['5', '0'],
      ['0', '3'],
    ]);
    const adj = await getEntry(count.adjustmentEntryId);
    expect(adj).toMatchObject({
      docstatus: 1,
      type: 'adjustment',
      date: '2026-09-10',
      warehouseId: fx.wh.main,
      sourceEntity: 'stock_count',
      sourceId: created.id,
    });
    expect(adj.lines.stock_entry_line.map((l) => [l.productId, l.sign, l.quantity, l.unitCost, l.amount])).toEqual([
      [pa, 'out', '1', '100', '100'],
      [pc, 'in', '3', '0', '0'],
    ]);
    expect(await balanceOf(pa, fx.wh.main)).toEqual(['8', '100', '800', 3]);
    expect(await balanceOf(pc, fx.wh.main)).toEqual(['3', '0', '0', 1]);
    const fixed = await fx.act<Table>(asRole(['accounting']), 'inventory.count_variance', { countId: created.id });
    expect(fixed.rows.map((r) => [r.systemQty, r.varianceQty, r.unitCost, r.varianceValue])).toEqual([
      ['9', '-1', '100', '-100'],
      ['5', '0', '0', '0'],
      ['0', '3', '0', '0'],
    ]);
    expect(fixed.totals).toEqual({ varianceValue: '-100' });
    expect(fixed.meta).toMatchObject({ live: false, adjustmentEntryId: adj.id });

    expect(await caught(cancelEntry(clerk, adj.id))).toBeInstanceOf(DependencyError);
    expect(
      await caught(
        fx.act(clerk, 'stock_count_line.update', {
          id: String(count.lines.stock_count_line[0]?.id),
          patch: { countedQty: '1' },
        }),
      ),
    ).toBeInstanceOf(StateError);
    await fx.act(clerk, 'stock_count.cancel', { id: created.id });
    expect((await getEntry(adj.id)).docstatus).toBe(DOCSTATUS.cancelled);
    expect(await balanceOf(pa, fx.wh.main)).toEqual(['9', '100', '900', 4]);
    expect(await balanceOf(pc, fx.wh.main)).toEqual(['0', '0', '0', 2]);

    const noVariance = await fx.act<Row & { id: string }>(clerk, 'stock_count.create', {
      lines: { stock_count_line: [{ productId: pb, countedQty: '5' }] },
    });
    expect(await fx.act<Row>(clerk, 'stock_count.submit', { id: noVariance.id })).toMatchObject({
      docstatus: 1,
      adjustmentEntryId: null,
    });
    const dup = await fx.act<Row & { id: string }>(clerk, 'stock_count.create', {
      lines: {
        stock_count_line: [
          { productId: pb, countedQty: '1' },
          { productId: pb, countedQty: '2' },
        ],
      },
    });
    expect(issuesOf(await caught(fx.act(clerk, 'stock_count.submit', { id: dup.id })))).toEqual(['lines.2.productId']);
    expect(
      issuesOf(
        await caught(
          fx.act(clerk, 'stock_count.submit', {
            id: (await fx.act<Row & { id: string }>(clerk, 'stock_count.create', {})).id,
          }),
        ),
      ),
    ).toEqual(['lines']);
  });

  it('AC-7 reports: stock_on_hand (current / warehouse / asOf), ledger with opening and running balance, valuation', async () => {
    const p = await newProduct('R');
    const r1 = await post({ type: 'receipt', date: '2026-07-01' }, [{ productId: p, quantity: '10', unitCost: '100' }]);
    const r2 = await post({ type: 'receipt', date: '2026-07-10' }, [{ productId: p, quantity: '10', unitCost: '130' }]);
    const t = await post({ type: 'transfer', date: '2026-07-15', toWarehouseId: fx.wh.sub }, [
      { productId: p, quantity: '4' },
    ]);
    await post({ type: 'issue', date: '2026-08-01' }, [{ productId: p, quantity: '3' }]);
    const onHand = (params: Partial<ContextParams>, input: Row) =>
      fx.act<Table>(params, 'inventory.stock_on_hand', input);
    const rowsFor = (tbl: Table) =>
      tbl.rows
        .filter((r) => r.productId === p)
        .map((r) => [r.productCode, r.productName, r.warehouseCode, r.qty, r.avgCost, r.value]);

    const current = await onHand(clerk, {});
    expect(current.columns.map((c) => c.key)).toEqual([
      'productCode',
      'productName',
      'warehouseCode',
      'qty',
      'avgCost',
      'value',
      'productId',
      'warehouseId',
    ]);
    expect(rowsFor(current)).toEqual([
      ['R', '品目R', 'MAIN', '13', '115', '1495'],
      ['R', '品目R', 'SUB', '4', '115', '460'],
    ]);
    const allValues = await fx.run(admin, async (ctx) =>
      Decimal.sum((await repo(ctx, StockBalance).list({ limit: 500 })).items.map((b) => b.value)).toString(),
    );
    expect(current.totals).toEqual({ value: allValues });
    expect(current.meta).toMatchObject({ source: 'balance', truncated: false });
    expect(current.rows.every((r) => !(r.qty === '0' && r.value === '0'))).toBe(true);
    expect(rowsFor(await onHand(asRole(['sales']), { warehouseId: fx.wh.sub }))).toEqual([
      ['R', '品目R', 'SUB', '4', '115', '460'],
    ]);
    expect(rowsFor(await onHand(clerk, { asOf: '2026-07-12' }))).toEqual([['R', '品目R', 'MAIN', '20', '115', '2300']]);
    const asOf15 = await onHand(clerk, { asOf: '2026-07-15' });
    expect(rowsFor(asOf15)).toEqual([
      ['R', '品目R', 'MAIN', '16', '115', '1840'],
      ['R', '品目R', 'SUB', '4', '115', '460'],
    ]);
    expect(asOf15.meta).toMatchObject({ source: 'ledger', asOf: '2026-07-15' });

    const ledger = await fx.act<Table>(asRole(['viewer']), 'inventory.ledger', {
      productId: p,
      warehouseId: fx.wh.main,
      from: '2026-07-05',
      to: '2026-07-31',
    });
    expect(
      ledger.rows.map((r) => [
        r.date,
        r.type,
        r.qtyIn,
        r.qtyOut,
        r.unitCost,
        r.costDelta,
        r.balanceQty,
        r.balanceValue,
        r.entryId,
      ]),
    ).toEqual([
      ['2026-07-05', 'opening', '0', '0', null, '0', '10', '1000', null],
      ['2026-07-10', 'receipt', '10', '0', '115', '1300', '20', '2300', r2.id],
      ['2026-07-15', 'transfer', '0', '4', '115', '-460', '16', '1840', t.id],
    ]);
    expect(ledger.rows[1]?.number).toBe(r2.number);
    expect(ledger.totals).toEqual({ qtyIn: '10', qtyOut: '4', costDelta: '840' });
    expect(ledger.meta).toMatchObject({
      productCode: 'R',
      opening: { qty: '10', value: '1000' },
      closing: { qty: '16', value: '1840' },
      truncated: false,
    });
    const all = await fx.act<Table>(clerk, 'inventory.ledger', { productId: p, from: '2026-01-01', to: '2026-12-31' });
    expect(all.rows.map((r) => [r.warehouseCode, r.balanceQty, r.balanceValue])).toEqual([
      [null, '0', '0'],
      ['MAIN', '10', '1000'],
      ['MAIN', '20', '2300'],
      ['MAIN', '16', '1840'],
      ['SUB', '20', '2300'],
      ['MAIN', '17', '1955'],
    ]);
    expect(all.rows[1]?.entryId).toBe(r1.id);
    expect(
      await caught(fx.act(clerk, 'inventory.ledger', { productId: p, from: '2026-02-01', to: '2026-01-01' })),
    ).toBeInstanceOf(ValidationError);

    const valuation = await fx.act<Table>(clerk, 'inventory.valuation', { asOf: '2026-12-31' });
    expect(
      valuation.rows.filter((r) => r.productId === p).map((r) => [r.productCode, r.qty, r.avgCost, r.value]),
    ).toEqual([['R', '17', '115', '1955']]);
    expect(valuation.totals).toEqual({ value: allValues });
    expect(valuation.meta).toMatchObject({ asOf: '2026-12-31', method: 'moving_average' });
    expect(
      (await fx.act<Table>(clerk, 'inventory.valuation', { asOf: '2026-06-30' })).rows.filter((r) => r.productId === p),
    ).toEqual([]);
    // accounting may not read products: the report still works, names fall back to ids
    const acct = await fx.act<Table>(asRole(['accounting']), 'inventory.valuation', { asOf: '2026-12-31' });
    expect(acct.rows.filter((r) => r.productId === p).map((r) => [r.productCode, r.productName, r.value])).toEqual([
      [null, p, '1955'],
    ]);
    expect(await caught(fx.act(asRole(['sales']), 'inventory.count_variance', { countId: p }))).toBeInstanceOf(
      PermissionDenied,
    );
    expect(await caught(fx.act(asRole([]), 'inventory.stock_on_hand', {}))).toBeInstanceOf(PermissionDenied);
    expect(await caught(fx.act(clerk, 'inventory.valuation', {}))).toBeInstanceOf(ValidationError);
  });

  it('AC-9 roles: purchasing receipts only, sales only through invoices, accounting / viewer read; inventory alone cannot read products', async () => {
    const purchasing = asRole(['purchasing']);
    const receipt = await createEntry(purchasing, { type: 'receipt' }, [
      { productId: fx.product.b, quantity: '1', unitCost: '10' },
    ]);
    expect((await submitEntry(purchasing, receipt.id)).docstatus).toBe(DOCSTATUS.submitted);
    const denied = await caught(createEntry(purchasing, { type: 'issue' }, []));
    expect(denied).toBeInstanceOf(PermissionDenied);
    expect((denied as PermissionDenied).details).toMatchObject({ entity: 'stock_entry', op: 'create:issue' });
    const draft = await createEntry(purchasing, { type: 'receipt' }, []);
    expect(
      (
        (await caught(
          fx.act(purchasing, 'stock_entry.update', { id: draft.id, patch: { type: 'transfer' } }),
        )) as PermissionDenied
      ).details,
    ).toMatchObject({ op: 'update:transfer' });
    const clerkIssue = await createEntry(clerk, { type: 'issue' }, [{ productId: fx.product.b, quantity: '1' }]);
    expect(
      (
        (await caught(
          fx.act(purchasing, 'stock_entry_line.create', {
            entryId: clerkIssue.id,
            productId: fx.product.b,
            quantity: '1',
          }),
        )) as PermissionDenied
      ).details,
    ).toMatchObject({ op: 'create:issue' });
    expect(((await caught(submitEntry(purchasing, clerkIssue.id))) as PermissionDenied).details).toMatchObject({
      op: 'submit:issue',
    });
    expect(await caught(fx.act(purchasing, 'stock_count.create', {}))).toBeInstanceOf(PermissionDenied);

    const sales = asRole(['sales']);
    expect(((await caught(createEntry(sales, { type: 'issue' }, []))) as PermissionDenied).details).toMatchObject({
      op: 'create:issue',
    });
    expect(((await caught(submitEntry(sales, clerkIssue.id))) as PermissionDenied).details).toMatchObject({
      op: 'submit:issue',
    });
    expect((await fx.act<{ total: number }>(sales, 'stock_entry.list', {})).total).toBeGreaterThan(0);
    expect(await caught(fx.act(sales, 'warehouse.update', { id: fx.wh.sub, patch: { name: 'x' } }))).toBeInstanceOf(
      PermissionDenied,
    );

    for (const roles of [['accounting'], ['viewer']]) {
      expect(await caught(fx.act(asRole(roles), 'stock_entry.create', { type: 'receipt' }))).toBeInstanceOf(
        PermissionDenied,
      );
      expect((await fx.act<{ total: number }>(asRole(roles), 'stock_ledger.list', {})).total).toBeGreaterThan(0);
      expect((await fx.act<{ total: number }>(asRole(roles), 'stock_count.list', {})).total).toBeGreaterThan(0);
    }
    expect(await caught(fx.act(asRole([]), 'stock_entry.list', {}))).toBeInstanceOf(PermissionDenied);
    // kernel/product gap (see the work log): product grants no read to `inventory`, so an inventory-only user cannot save a line
    const alone = await caught(
      createEntry(asRole(['inventory']), { type: 'receipt' }, [
        { productId: fx.product.b, quantity: '1', unitCost: '1' },
      ]),
    );
    expect((alone as PermissionDenied).details).toMatchObject({ entity: 'product', op: 'read' });
  });

  it('AC-1 stock_ledger is append-only and stock_balance derived: every direct write is refused, admin included; balances equal the ledger replay', async () => {
    const guard = async (p: Promise<unknown>) => {
      const e = await caught(p);
      expect(e).toBeInstanceOf(StateError);
      expect((e as StateError).hint).toBe(LEDGER_WRITE_HINT);
    };
    const anyRow = await fx.run(admin, async (ctx) => (await repo(ctx, StockLedger).list({ limit: 1 })).items[0]);
    const anyBalance = await fx.run(admin, async (ctx) => (await repo(ctx, StockBalance).list({ limit: 1 })).items[0]);
    const id = anyRow?.id ?? '';
    const values = {
      date: '2026-09-10',
      warehouseId: fx.wh.main,
      productId: fx.product.a,
      qtyDelta: '1',
      unitCost: '1',
      costDelta: '1',
      balanceQty: '1',
      balanceCost: '1',
      sourceEntity: 'x',
      sourceId: id,
      seq: 999,
    };
    await guard(fx.act(admin, 'stock_ledger.create', values));
    await guard(fx.act(clerk, 'stock_ledger.create', values));
    await guard(fx.act(admin, 'stock_ledger.update', { id, patch: { qtyDelta: '2' } }));
    await guard(fx.act(admin, 'stock_ledger.delete', { id }));
    await guard(fx.run(admin, (ctx) => repo(ctx, StockLedger).update(id, {})));
    await guard(fx.act(admin, 'stock_balance.create', { productId: fx.product.c, warehouseId: fx.wh.sub, qty: '5' }));
    await guard(fx.act(clerk, 'stock_balance.update', { id: anyBalance?.id, patch: { qty: '5' } }));
    await guard(fx.act(admin, 'stock_balance.delete', { id: anyBalance?.id }));
    expect(await caught(fx.act(asRole(['viewer']), 'stock_ledger.create', values))).toBeInstanceOf(PermissionDenied);

    const replay = await fx.run(admin, async (ctx: Context) => {
      const sums = await repo(ctx, StockLedger).aggregate({
        groupBy: ['productId', 'warehouseId'],
        metrics: {
          qty: { sum: 'qtyDelta' },
          value: { sum: 'costDelta' },
          rows: { count: true },
          lastSeq: { max: 'seq' },
        },
      });
      const balances: Infer<typeof StockBalance>[] = (await repo(ctx, StockBalance).list({ limit: 500 })).items;
      return { sums, balances };
    });
    expect(replay.balances.length).toBe(replay.sums.length);
    for (const b of replay.balances) {
      const s = replay.sums.find((x) => x.productId === b.productId && x.warehouseId === b.warehouseId);
      expect([
        (s?.qty as Decimal).toString(),
        (s?.value as Decimal).toString(),
        Number(s?.rows),
        Number(s?.lastSeq),
      ]).toEqual([b.qty.toString(), b.value.toString(), b.lastSeq, b.lastSeq]);
    }
    expect(Warehouse.name).toBe('warehouse');
    expect(StockEntryLine.name).toBe('stock_entry_line');
  });
});
