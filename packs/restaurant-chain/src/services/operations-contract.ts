import { isLocalDate, tableResult } from '@daifuku/kernel';
import { z } from 'zod';
const localDate = z.string().refine(isLocalDate, 'YYYY-MM-DD');
export const operationsInput = z.object({
  from: localDate.meta({ title: '開始日' }),
  to: localDate.meta({ title: '終了日' }),
  asOf: localDate.optional().meta({ title: '基準日（省略時は今日）' }),
  storeId: z.uuid().optional().meta({ title: '店舗（空欄は権限内の全店舗）' }),
});
export type OperationsInput = z.output<typeof operationsInput>;
export const operationsRange = z.object({
  from: localDate,
  to: localDate,
  asOf: localDate,
  previousFrom: localDate,
  previousTo: localDate,
  timeZone: z.literal('Asia/Tokyo'),
  workflowBasis: z.literal('current'),
});
export type OperationsRange = z.output<typeof operationsRange>;
const money = z.string();
const ratio = z.string().nullable();
export const operationsOverview = z.object({
  grossSales: money,
  netSales: money,
  tax: money,
  cashSales: money,
  cardSales: money,
  qrSales: money,
  consumptionCost: money,
  wasteCost: money,
  targetSales: money,
  achievementPct: ratio,
  cashDifference: ratio,
  expectedOpenDays: z.number().int(),
  submittedDays: z.number().int(),
  missingDays: z.number().int(),
  reviewPendingDays: z.number().int(),
  finalizePendingDays: z.number().int(),
  zeroSalesDays: z.number().int(),
  closedDays: z.number().int(),
  unplannedDays: z.number().int(),
  previousGrossSales: money,
  changeAmount: money,
  changePct: ratio,
});
export const operationsResult = z.object({
  range: operationsRange,
  overview: operationsOverview,
  series: tableResult,
  stores: tableResult,
  submissions: tableResult,
  sourceTable: tableResult,
});
export type OperationsSnapshot = z.output<typeof operationsResult>;
export type OperationsOverview = z.output<typeof operationsOverview>;
