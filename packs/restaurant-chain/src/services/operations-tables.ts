import { column, label, type TableResult } from '@daifuku/kernel';
import { dates } from './operation-dates.ts';
import { amountColumns, amountValues, ratio, totalFacts, type Fact } from './operations-facts.ts';
import { summarizeBoard, type BoardRow } from './operations-board.ts';
import type { Store } from './operations-data.ts';
import type { OperationsRange } from './operations-contract.ts';
const targetColumn = () => column('targetSales', label('税込売上目標', 'Gross sales target'), 'decimal');
export function seriesTable(facts: Fact[], board: BoardRow[], range: OperationsRange): TableResult {
  return {
    title: label('売上・目標の推移', 'Daily sales and targets'),
    columns: [column('date', label('計上日', 'Effective date'), 'date'), ...amountColumns(), targetColumn()],
    rows: dates(range.from, range.to).map((date) => ({
      date,
      ...amountValues(totalFacts(facts.filter((f) => f.effectiveDate === date))),
      targetSales: summarizeBoard(board.filter((row) => row.date === date)).target.toString(),
    })),
  };
}
export function storesTable(stores: Store[], facts: Fact[], previous: Fact[], board: BoardRow[]): TableResult {
  const columns = [
    column('store', label('店舗', 'Store'), 'text'),
    ...amountColumns(),
    targetColumn(),
    column('achievementPct', label('目標達成率 %', 'Target achievement %'), 'decimal'),
    column('previousGrossSales', label('前期間税込売上', 'Previous period gross sales'), 'decimal'),
    column('changeAmount', label('前期間差額', 'Period change'), 'decimal'),
    column('changePct', label('前期間増減率 %', 'Period change %'), 'decimal'),
    column('expectedOpenDays', label('営業予定日', 'Planned open days'), 'int'),
    column('missingDays', label('未提出日', 'Missing days'), 'int'),
    column('reviewPendingDays', label('確認待ち', 'Awaiting review'), 'int'),
    column('finalizePendingDays', label('本部確定待ち', 'Awaiting finalization'), 'int'),
  ];
  const rows = stores.map((store) => {
    const total = totalFacts(facts.filter((f) => f.storeId === store.id));
    const prior = totalFacts(previous.filter((f) => f.storeId === store.id)).amounts.grossSales;
    const { target, ...counts } = summarizeBoard(board.filter((row) => row.storeId === store.id));
    const change = total.amounts.grossSales.minus(prior);
    return {
      storeId: store.id,
      store: store.name,
      ...amountValues(total),
      targetSales: target.toString(),
      achievementPct: ratio(total.amounts.grossSales, target),
      previousGrossSales: prior.toString(),
      changeAmount: change.toString(),
      changePct: ratio(change, prior),
      ...counts,
    };
  });
  return {
    title: label('店舗比較', 'Store comparison'),
    columns,
    rows,
    meta: {
      comparisonBasis: 'previous_equal_calendar_days',
      ratioBasis: 'sum_actual_divided_by_sum_target',
      inventoryCostBasis: 'moving_average_subledger',
    },
  };
}
