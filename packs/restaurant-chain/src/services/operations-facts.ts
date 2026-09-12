import { column, Decimal, label, MAX_REPORT_ROWS, StateError, ValidationError, type TableResult } from '@daifuku/kernel';
import { RestaurantClosing } from '../entities/closing.ts';
import type { Closing, OperationsData } from './operations-data.ts';
export const measureFields = { grossSales: 'total', netSales: 'subtotal', tax: 'taxTotal', cashSales: 'cashAmount', cardSales: 'cardAmount', qrSales: 'qrAmount', consumptionCost: 'consumptionCost', wasteCost: 'wasteCost' } as const;
export const measureLabels = { grossSales: '税込売上', netSales: '税抜売上', tax: '消費税', cashSales: '現金売上', cardSales: 'カード売上', qrSales: 'QR売上', consumptionCost: '材料消費評価額', wasteCost: '材料廃棄評価額' } as const;
export type Measure = keyof typeof measureFields;
export interface Fact { closingId: string; closingNumber: string; storeId: string; store: string; date: string; effectiveDate: string; entryKind: 'posting' | 'cancellation'; amounts: Record<Measure, Decimal>; cashDifference: Decimal | null }
export interface Amounts { amounts: Record<Measure, Decimal>; cashDifference: Decimal | null }
export const zeroAmounts = (): Amounts => ({ amounts: Object.fromEntries(Object.keys(measureFields).map((key) => [key, Decimal.zero()])) as Record<Measure, Decimal>, cashDifference: Decimal.zero() });
export function addAmounts(target: Amounts, source: Amounts): void {
  for (const key of Object.keys(measureFields) as Measure[]) target.amounts[key] = target.amounts[key].plus(source.amounts[key]);
  target.cashDifference = target.cashDifference === null || source.cashDifference === null ? null : target.cashDifference.plus(source.cashDifference);
}
export function amountValues(total: Amounts): Record<Measure, string> & { cashDifference: string | null } {
  return { ...Object.fromEntries(Object.entries(total.amounts).map(([key, amount]) => [key, amount.toString()])) as Record<Measure, string>, cashDifference: total.cashDifference?.toString() ?? null };
}
export function totalFacts(facts: Fact[]): Amounts { const total = zeroAmounts(); for (const fact of facts) addAmounts(total, fact); return total; }
export function ratio(actual: Decimal, base: Decimal): string | null { return base.isZero() ? null : actual.div(base).times('100').roundHalfUp(2).toString(); }
function fact(row: Closing, store: string, date: string, sign: '1' | '-1'): Fact {
  if (!row.number) throw new StateError('確定締めの伝票番号が不明です', 'Restore the original closing number before reporting.');
  return { closingId: row.id, closingNumber: row.number, storeId: row.storeId, store, date: row.date, effectiveDate: date, entryKind: sign === '1' ? 'posting' : 'cancellation', amounts: Object.fromEntries(Object.entries(measureFields).map(([key, field]) => [key, row[field].times(sign)])) as Record<Measure, Decimal>, cashDifference: row.cashSalesCounted === null ? null : row.cashSalesCounted.minus(row.cashAmount).times(sign) };
}
export function sourceFacts(data: OperationsData, from: string, to: string, asOf: string): Fact[] {
  const result: Fact[] = [];
  const stores = new Map(data.stores.map((store) => [store.id, store.name]));
  for (const row of data.closings) {
    if (row.docstatus === 0) continue;
    if (row.docstatus === 2 && !row.cancelledDate) throw new StateError('取消有効日が不明な締めがあります', 'Restore its historical cancellation date before reporting.');
    const add = (date: string, sign: '1' | '-1') => { if (date >= from && date <= to && date <= asOf) result.push(fact(row, stores.get(row.storeId) ?? row.storeId, date, sign)); };
    add(row.date, '1'); if (row.docstatus === 2 && row.cancelledDate) add(row.cancelledDate, '-1');
  }
  if (result.length > MAX_REPORT_ROWS) throw new ValidationError('根拠行が多すぎます。店舗・期間を絞ってください', [{ path: 'from', message: `maximum ${MAX_REPORT_ROWS} posting and reversal facts` }]);
  return result.sort((a, b) => `${a.effectiveDate}/${a.store}/${a.closingNumber}/${a.entryKind}`.localeCompare(`${b.effectiveDate}/${b.store}/${b.closingNumber}/${b.entryKind}`));
}
export const amountColumns = () => [...Object.entries(measureLabels).map(([key, title]) => column(key, label(title, key), 'decimal')), column('cashDifference', label('現金売上実収差（未点検は不明）', 'Cash sales difference'), 'decimal')];
export function sourceTable(facts: Fact[]): TableResult {
  const total = amountValues(totalFacts(facts));
  return { title: label('日次締めの計上・取消根拠', 'Closing posting and reversal evidence'), columns: [column('closingId', label('元の締め', 'Closing'), 'ref', { ref: RestaurantClosing.name }), column('closingNumber', label('締め番号', 'Closing number'), 'text'), column('store', label('店舗', 'Store'), 'text'), column('date', label('営業日', 'Business date'), 'date'), column('effectiveDate', label('計上日', 'Effective date'), 'date'), column('entryKind', label('計上・取消', 'Entry kind'), 'text'), ...amountColumns()], rows: facts.map(({ amounts, cashDifference, ...refs }) => ({ ...refs, ...amountValues({ amounts, cashDifference }) })), totals: Object.fromEntries(Object.entries(total).filter((entry): entry is [string, string] => entry[1] !== null)), meta: { inventoryCostBasis: 'moving_average_subledger', cancellationBasis: 'effective_date', cashDifferenceUnknown: total.cashDifference === null, timeZone: 'Asia/Tokyo' } };
}
