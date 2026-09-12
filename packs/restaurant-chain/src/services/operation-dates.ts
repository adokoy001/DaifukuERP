import { todayLocal, ValidationError, type Context } from '@daifuku/kernel';
import type { OperationsInput, OperationsRange } from './operations-contract.ts';
export const today = (ctx: Context): string => todayLocal(ctx.now(), 'Asia/Tokyo');
export function shiftDay(date: string, offset: number): string { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); }
export function dayCount(from: string, to: string): number { return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1; }
export function dates(from: string, to: string): string[] { return Array.from({ length: dayCount(from, to) }, (_, i) => shiftDay(from, i)); }
export function assertPeriod(from: string, to: string): void {
  if (from > to || dayCount(from, to) > 366) throw new ValidationError('期間は開始日から366日以内で指定してください', [{ path: 'to', message: 'from <= to, maximum 366 inclusive days' }]);
}
export function resolveRange(ctx: Context, input: OperationsInput): OperationsRange {
  assertPeriod(input.from, input.to);
  const asOf = input.asOf ?? today(ctx);
  if (input.to > asOf || asOf > today(ctx)) throw new ValidationError('終了日・基準日は今日以前にしてください', [{ path: 'asOf', message: 'to <= asOf <= today in Asia/Tokyo' }]);
  const count = dayCount(input.from, input.to);
  return { from: input.from, to: input.to, asOf, previousFrom: shiftDay(input.from, -count), previousTo: shiftDay(input.from, -1), timeZone: 'Asia/Tokyo', workflowBasis: 'current' };
}
