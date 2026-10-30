// Balance chart of /finance/cash-forecast (docs/specs/cash-forecast.md AC-21): an inline SVG line of every day's
// balance with a zero baseline; the part below zero is drawn in the danger colour (two clipped copies of one path) and
// the balance with drafts is a dashed line with a legend. The SVG is role="img" with a summary label; exact values are
// in the daily table (the same approach as operations-trend.tsx).
import { useId } from 'react';
import type { CashForecastRow } from '@daifuku/mod-banking/contract';
import { useLocale } from '../i18n.tsx';
import { chartModel } from '../lib/cash-forecast.ts';
import { formatDecimal } from '../lib/format.ts';

export function CashForecastChart({
  rows,
  includeDrafts,
  label,
  scale,
}: {
  rows: readonly CashForecastRow[];
  includeDrafts: boolean;
  label: string;
  scale: number;
}) {
  const { t } = useLocale();
  const id = useId().replace(/:/g, '');
  const m = chartModel(rows, includeDrafts);
  const above = `${id}-above`;
  const below = `${id}-below`;
  return (
    <figure className="cash-chart" data-testid="cash-chart">
      <svg viewBox={`0 0 ${m.width} ${m.height}`} role="img" aria-label={label} className="cash-chart-svg">
        <defs>
          <clipPath id={above}>
            <rect x="0" y="0" width={m.width} height={Math.max(0, m.zeroY)} />
          </clipPath>
          <clipPath id={below}>
            <rect x="0" y={m.zeroY} width={m.width} height={Math.max(0, m.height - m.zeroY)} />
          </clipPath>
        </defs>
        <line x1={m.left} x2={m.right} y1={m.top} y2={m.top} className="cash-chart-grid" />
        <line x1={m.left} x2={m.right} y1={m.bottom} y2={m.bottom} className="cash-chart-grid" />
        <line x1={m.left} x2={m.right} y1={m.zeroY} y2={m.zeroY} className="cash-chart-zero" />
        <text x={m.left - 6} y={m.top + 4} textAnchor="end" className="cash-chart-label">
          {formatDecimal(m.max, scale)}
        </text>
        <text x={m.left - 6} y={m.zeroY + 4} textAnchor="end" className="cash-chart-label">
          0
        </text>
        {m.min.startsWith('-') ? (
          <text x={m.left - 6} y={m.bottom + 4} textAnchor="end" className="cash-chart-label">
            {formatDecimal(m.min, scale)}
          </text>
        ) : null}
        {includeDrafts ? <path d={m.draftPath} className="cash-chart-drafts" /> : null}
        <path d={m.path} className="cash-chart-line" clipPath={`url(#${above})`} />
        <path d={m.path} className="cash-chart-line is-negative" clipPath={`url(#${below})`} />
        {m.points.length <= 62
          ? m.points.map((p) => (
              <circle
                key={p.date}
                cx={p.x}
                cy={p.y}
                r={2.5}
                className={p.balance.startsWith('-') ? 'cash-chart-dot is-negative' : 'cash-chart-dot'}
              >
                <title>{`${p.date} · ${formatDecimal(p.balance, scale)}`}</title>
              </circle>
            ))
          : null}
        <text x={m.left} y={m.height - 10} className="cash-chart-label">
          {m.points[0]?.date}
        </text>
        <text x={m.right} y={m.height - 10} textAnchor="end" className="cash-chart-label">
          {m.points.at(-1)?.date}
        </text>
      </svg>
      <figcaption className="cash-chart-legend">
        <span className="cash-legend-balance">{t({ ja: '残高', en: 'Balance' })}</span>
        <span className="cash-legend-negative">{t({ ja: '残高（マイナス）', en: 'Balance below zero' })}</span>
        {includeDrafts ? (
          <span className="cash-legend-drafts">{t({ ja: '下書きを含む残高', en: 'Balance incl. drafts' })}</span>
        ) : null}
      </figcaption>
    </figure>
  );
}
