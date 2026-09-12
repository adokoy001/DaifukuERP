import type { OperationsFilters } from '../api/operations.ts';
import { compareDecimalStrings, parseDecimalString } from './decimal.ts';
export function businessToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return get('year') + '-' + get('month') + '-' + get('day');
}
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parseOperationsSearch(raw: Record<string, unknown>, now = new Date()): OperationsFilters {
  const today = businessToday(now);
  return { from: validDate(raw.from) ? raw.from : today.slice(0, 8) + '01', to: validDate(raw.to) ? raw.to : today, asOf: validDate(raw.asOf) ? raw.asOf : today, ...(typeof raw.storeId === 'string' && /^[0-9a-f-]{36}$/i.test(raw.storeId) ? { storeId: raw.storeId } : {}) };
}
export function maximumMagnitude(values: string[]): string {
  return values.reduce((max, value) => { const abs = value.replace(/^[+-]/, ''); return compareDecimalStrings(abs, max) === 1 ? abs : max; }, '0');
}
/** Decimal amounts stay exact; only a bounded ratio becomes a number for SVG coordinates. */
export function chartRatio(value: string, max: string): number {
  const a = parseDecimalString(value), b = parseDecimalString(max);
  if (!a || !b) return 0;
  const scale = Math.max(a.frac.length, b.frac.length);
  const av = BigInt(a.int + a.frac.padEnd(scale, '0')), bv = BigInt(b.int + b.frac.padEnd(scale, '0'));
  if (bv === 0n) return 0;
  const bounded = av > bv ? bv : av;
  return Number((bounded * 10_000n) / bv) / 10_000 * (a.neg ? -1 : 1);
}
export const reviewLabels: Record<string, { ja: string; en: string }> = { review_pending: { ja: '店長確認待ち', en: 'Awaiting review' }, finalize_pending: { ja: '本部確定待ち', en: 'Awaiting posting' }, scheduled_closed: { ja: '休業予定', en: 'Planned closure' }, draft: { ja: '下書き', en: 'Draft' }, submitted: { ja: '店長確認待ち', en: 'Awaiting review' }, approved: { ja: '本部確定待ち', en: 'Awaiting posting' }, returned: { ja: '差戻し', en: 'Returned' }, finalized: { ja: '確定済み', en: 'Posted' }, missing: { ja: '未提出', en: 'Missing' }, no_sales: { ja: '売上ゼロ', en: 'No sales' }, closed: { ja: '休業', en: 'Closed' }, cancelled: { ja: '取消', en: 'Cancelled' }, unplanned: { ja: '計画なし', en: 'Unplanned' } };
