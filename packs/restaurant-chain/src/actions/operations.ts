import { defineAction, label, tableResult, type Context } from '@daifuku/kernel';
import { RestaurantClosing } from '../entities/closing.ts';
import { RestaurantStore } from '../entities/store.ts';
import { RestaurantDayPlan } from '../entities/day-plan.ts';
import { operationsInput, operationsResult, type OperationsInput, type OperationsSnapshot } from '../services/operations-contract.ts';
import { resolveRange } from '../services/operation-dates.ts';
import { operationsData } from '../services/operations-data.ts';
import { amountValues, ratio, sourceFacts, sourceTable, totalFacts } from '../services/operations-facts.ts';
import { boardRows, submissionsTable, summarizeBoard } from '../services/operations-board.ts';
import { seriesTable, storesTable } from '../services/operations-tables.ts';
export async function operationsSnapshot(ctx: Context, input: OperationsInput): Promise<OperationsSnapshot> {
  const range = resolveRange(ctx, input), data = await operationsData(ctx, input, range);
  const facts = sourceFacts(data, range.from, range.to, range.asOf), previous = sourceFacts(data, range.previousFrom, range.previousTo, range.asOf);
  const board = boardRows(data, range), { target, ...counts } = summarizeBoard(board);
  const total = totalFacts(facts), prior = totalFacts(previous).amounts.grossSales, change = total.amounts.grossSales.minus(prior);
  const overview = { ...amountValues(total), targetSales: target.toString(), achievementPct: ratio(total.amounts.grossSales, target), ...counts, previousGrossSales: prior.toString(), changeAmount: change.toString(), changePct: ratio(change, prior) };
  return { range, overview, series: seriesTable(facts, board, range), stores: storesTable(data.stores, facts, previous, board), submissions: submissionsTable(board), sourceTable: sourceTable(facts) };
}
export const operationsSnapshotAction = defineAction({ name: 'restaurant_chain.operations_snapshot', description: label('チェーン運営ボード', 'Chain operations snapshot'), input: operationsInput, output: operationsResult, permission: { entity: RestaurantClosing.name, op: 'read' }, storeAccess: true, exportEntities: [RestaurantClosing.name, RestaurantStore.name, RestaurantDayPlan.name], tx: 'none', mutates: false, handler: operationsSnapshot });
export const operationsSourcesAction = defineAction({ name: 'restaurant_chain.operations_sources', description: label('運営集計の元伝票・CSV', 'Operations source evidence and CSV'), input: operationsInput, output: tableResult, permission: { entity: RestaurantClosing.name, op: 'read' }, storeAccess: true, exportEntities: [RestaurantClosing.name, RestaurantStore.name, RestaurantDayPlan.name], tx: 'none', mutates: false, handler: async (ctx, input) => {
  const range = resolveRange(ctx, input), data = await operationsData(ctx, input, range);
  return sourceTable(sourceFacts(data, range.from, range.to, range.asOf));
} });
