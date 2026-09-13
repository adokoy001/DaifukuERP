import { newId, registerCrudActions, repo, runAction, type Context } from '@daifuku/kernel';
import { freshDb } from '@daifuku/kernel/testing';
import { Account, JournalLine, openFiscalYear } from '@daifuku/mod-accounting';
import { Product, seedUoms } from '@daifuku/mod-product';
import { Partner } from '@daifuku/mod-partner';
import { StockBalance, StockLedger, Warehouse, seedWarehouses } from '@daifuku/mod-inventory';
import { type TradeCommand, type TradeOrderDetail } from '../src/index.ts';
export const DAY = '2026-09-12';
// Quantity model uses quarter units, and money remains exact integer JPY.
export const quantity = (quarters: number): string => quarters < 0 ? '-' + quantity(-quarters) : `${Math.floor(quarters / 4)}${['', '.25', '.5', '.75'][quarters % 4]}`;
export async function tradeModelFixture() {
  registerCrudActions(); const db = await freshDb();
  const run = <T>(work: (ctx: Context) => Promise<T>) => db.run({ now: () => new Date('2026-09-13T03:00:00Z') }, work);
  const action = (name: string, input: unknown) => run((ctx) => runAction(ctx, name, input)) as Promise<TradeCommand>;
  const detail = (orderId: string) => run((ctx) => runAction(ctx, 'trade.order_detail', { orderId })) as Promise<TradeOrderDetail>;
  const accounts = new Map<string, string>();
  const warehouse = await run(async (ctx) => {
    await seedUoms(ctx); await seedWarehouses(ctx); await openFiscalYear(ctx, { startDate: '2026-01-01' });
    for (const [code, type] of [['2400', 'liability'], ['1900', 'asset'], ['1100', 'asset'], ['1300', 'asset'], ['2100', 'liability'], ['4000', 'revenue'], ['5000', 'expense'], ['2200', 'liability'], ['1500', 'asset']] as const) {
      accounts.set(code, (await repo(ctx, Account).create({ code, name: code, type, partnerRequired: ['1300', '2100'].includes(code) })).id);
    }
    return required((await repo(ctx, Warehouse).list({ limit: 1 })).items[0]).id;
  });
  async function order(direction: 'sales' | 'purchase', quarters: number) {
    const values = await run(async (ctx) => ({
      partner: await repo(ctx, Partner).create({ name: 'Generated trade ' + newId(), isCustomer: true, isSupplier: true }),
      product: await repo(ctx, Product).create({ code: newId().slice(-24), name: 'Generated quarter units', salePrice: '1200', purchasePrice: '800' }),
    }));
    if (direction === 'sales') {
      const stock = await action('stock_entry.create', { type: 'receipt', date: DAY, warehouseId: warehouse, lines: { stock_entry_line: [{ productId: values.product.id, quantity: '100', unitCost: '800' }] } });
      await action('stock_entry.submit', { id: stock.id });
    }
    const created = await action('trade_order.create', { direction, partnerId: values.partner.id, date: DAY, lines: { trade_order_line: [{ productId: values.product.id, description: 'Generated agreement', quantity: quantity(quarters), unitPrice: direction === 'sales' ? '1200' : '800', taxCategory: 'exempt' }] } });
    await action('trade_order.submit', { id: created.id });
    return { ...values, id: created.id, direction, quarters };
  }
  async function projection(order: Awaited<ReturnType<typeof order>>) {
    return run(async (ctx) => {
      const stock = await repo(ctx, StockBalance).list({ where: { productId: order.product.id, warehouseId: warehouse } });
      const ledger = await repo(ctx, StockLedger).list({ where: { productId: order.product.id }, orderBy: [{ field: 'seq', dir: 'asc' }], limit: 500 });
      const lines = await repo(ctx, JournalLine).list({ where: { partnerId: order.partner.id, accountId: required(accounts.get(order.direction === 'sales' ? '1300' : '2100')), posted: true }, limit: 500 });
      const net = lines.items.reduce((sum, line) => sum + BigInt(line.debit.toString()) - BigInt(line.credit.toString()), 0n);
      return { quantity: stock.items[0]?.qty.toString() ?? '0', cost: stock.items[0]?.value.toString() ?? '0', movements: ledger.items.map((line) => ({ qty: line.qtyDelta.toString(), cost: line.costDelta.toString(), reverse: line.reversal })), journalLineCount: lines.total, net: String(order.direction === 'sales' ? net : -net) };
    });
  }
  return { db, run, action, detail, order, projection, warehouse };
}
export type TradeFixture = Awaited<ReturnType<typeof tradeModelFixture>>;
export function required<T>(value: T | undefined | null): T { if (value === null || value === undefined) throw new Error('Missing generated fixture value'); return value; }
