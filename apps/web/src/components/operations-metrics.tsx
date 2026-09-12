import type { OperationsOverview } from '../api/operations.ts';
import type { Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { formatDecimal } from '../lib/format.ts';
function Metric({ label, value, detail, tone = 'violet', suffix = '円' }: { label: Label; value: string | null; detail: string; tone?: string; suffix?: string }) {
  const { t } = useLocale();
  return <article className={'operations-metric tone-' + tone}><h2>{t(label)}</h2><strong>{value === null ? '—' : formatDecimal(value, 0)}{value !== null ? <small>{suffix}</small> : null}</strong><p>{detail}</p></article>;
}
export function OperationsMetrics({ data }: { data: OperationsOverview }) {
  const { t } = useLocale();
  const comparison = data.changePct === null ? t({ ja: '前期間の売上が0のため増減率なし', en: 'No change rate because previous sales were zero' }) : t({ ja: '前期間比 ', en: 'vs previous period ' }) + formatDecimal(data.changePct, 0) + '%';
  return <><div className="operations-metrics"><Metric label={{ ja: '税込売上', en: 'Gross sales' }} value={data.grossSales} detail={comparison} /><Metric label={{ ja: '目標達成率', en: 'Target achievement' }} value={data.achievementPct} suffix="%" tone="green" detail={t({ ja: '目標 ', en: 'Target ' }) + formatDecimal(data.targetSales, 0) + t({ ja: ' 円', en: ' JPY' })} /><Metric label={{ ja: '現金差異', en: 'Cash variance' }} value={data.cashDifference} tone="coral" detail={t(data.cashDifference === null ? { ja: '実収現金の未報告分があります', en: 'Some actual cash amounts are unreported' } : { ja: '申告した実収現金 − 現金売上', en: 'Reported cash received minus cash sales' })} /><Metric label={{ ja: '材料廃棄原価', en: 'Ingredient waste cost' }} value={data.wasteCost} tone="blue" detail={t({ ja: '在庫補助簿の評価額', en: 'Inventory subledger valuation' })} /></div>
    <div className="operations-status-strip" aria-label={t({ ja: '日次報告の状況', en: 'Daily reporting status' })}>{[[data.expectedOpenDays, { ja: '計画営業日', en: 'Planned open days' }], [data.missingDays, { ja: '未提出', en: 'Missing' }], [data.reviewPendingDays, { ja: '店長確認待ち', en: 'Awaiting review' }], [data.finalizePendingDays, { ja: '本部確定待ち', en: 'Awaiting posting' }], [data.zeroSalesDays, { ja: '売上ゼロ', en: 'No sales' }], [data.closedDays, { ja: '休業', en: 'Closed' }]].map(([value, label]) => <div key={(label as Label).en}><b>{value as number}</b><span>{t(label as Label)}</span></div>)}</div>
  </>;
}
