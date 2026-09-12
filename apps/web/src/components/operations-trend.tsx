import type { TableResult } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { formatDecimal } from '../lib/format.ts';
import { chartRatio, maximumMagnitude } from '../lib/operations.ts';
export function OperationsTrend({ series }: { series: TableResult }) {
  const { t } = useLocale();
  const points = series.rows.map((row) => ({ date: String(row.date), sales: String(row.grossSales ?? '0'), target: String(row.targetSales ?? '0') }));
  const max = maximumMagnitude(points.flatMap((p) => [p.sales, p.target]));
  const hasNegative = points.some((p) => p.sales.startsWith('-') || p.target.startsWith('-'));
  const baseline = hasNegative ? 112 : 195, height = hasNegative ? 80 : 163;
  const x = (index: number) => 58 + index / Math.max(1, points.length - 1) * 624;
  const y = (value: string) => baseline - chartRatio(value, max) * height;
  const path = (key: 'sales' | 'target') => points.map((p, i) => (i ? 'L' : 'M') + x(i) + ' ' + y(p[key])).join(' ');
  return points.length ? <svg viewBox="0 0 740 242" role="img" aria-label={t({ ja: '日別の税込売上と売上目標。正確な値は下の日別表で確認できます。', en: 'Daily gross sales and targets. Exact values are available in the daily table below.' })} className="operations-chart"><line x1="58" x2="682" y1={baseline} y2={baseline} className="chart-axis" /><line x1="58" x2="682" y1="32" y2="32" className="chart-grid" /><text x="56" y="22" className="chart-label">{formatDecimal(max, 0)}</text><text x="35" y={baseline + 5} className="chart-label">0</text><path d={path('target')} className="chart-target" /><path d={path('sales')} className="chart-sales" />{points.map((p, i) => <circle key={p.date} cx={x(i)} cy={y(p.sales)} r={points.length > 60 ? 1.5 : 3} className="chart-dot"><title>{p.date + ' · ' + formatDecimal(p.sales, 0) + ' / ' + formatDecimal(p.target, 0)}</title></circle>)}<text x="58" y="225" className="chart-label">{points[0]?.date}</text><text x="682" y="225" textAnchor="end" className="chart-label">{points.at(-1)?.date}</text></svg> : <p>{t({ ja: 'この期間のデータがありません。', en: 'No data in this period.' })}</p>;
}
