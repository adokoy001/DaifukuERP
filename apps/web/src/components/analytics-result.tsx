import { useMemo, useState } from 'react';
import type { AnalyticsDataset } from '../api/analytics.ts';
import { useLocale } from '../i18n.tsx';
import { OP_LABELS, type AnalyticsSettings } from '../lib/analytics.ts';
import { groupDigits as formatDecimal } from '../lib/format.ts';
import { cellKey, visibleNodes, type PivotNode, type PivotResult } from '../lib/pivot.ts';

export function shortAxisLabel(label: string): string {
  return label.replace(/ \[([0-9a-f-]{30,})\]$/i, (_, id: string) => ` · ${id.slice(-6)}`);
}
function chartAxisLabel(node: PivotNode): string {
  // The full parent path and identifier remain in the tooltip and table. A repeated parent prefix
  // hides the distinguishing leaf name on narrow screens, so reserve the tick for that leaf.
  const label = node.label.replace(/ \[[0-9a-f-]{30,}\]$/i, '');
  const characters = Array.from(label);
  return characters.length > 10 ? `${characters.slice(0, 9).join('')}…` : label;
}
function chartScaleLabel(value: number): string {
  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  return compact.length <= 8
    ? compact
    : new Intl.NumberFormat('en', { notation: 'scientific', maximumFractionDigits: 1 }).format(value);
}
function Paging({
  page,
  pages,
  onChange,
  label,
}: {
  page: number;
  pages: number;
  onChange(value: number): void;
  label: string;
}) {
  const { t } = useLocale();
  return (
    <div className="analytics-paging" aria-label={label}>
      <span>
        {label} {page + 1} / {pages}
      </span>
      <button className="btn" disabled={page <= 0} type="button" onClick={() => onChange(page - 1)}>
        {t({ ja: '前へ', en: 'Previous' })}
      </button>
      <button className="btn" disabled={page >= pages - 1} type="button" onClick={() => onChange(page + 1)}>
        {t({ ja: '次へ', en: 'Next' })}
      </button>
    </div>
  );
}
export function AnalyticsResult({
  result,
  settings,
  dataset,
  onExpand,
}: {
  result: PivotResult;
  settings: AnalyticsSettings;
  dataset: AnalyticsDataset;
  onExpand(axis: 'rows' | 'columns', key: string): void;
}) {
  const { t } = useLocale();
  const [rowPage, setRowPage] = useState(0);
  const [columnPage, setColumnPage] = useState(0);
  const rowSet = useMemo(() => new Set(settings.expandedRows), [settings.expandedRows]);
  const colSet = useMemo(() => new Set(settings.expandedColumns), [settings.expandedColumns]);
  const visible = (nodes: PivotNode[], expanded: Set<string>) =>
    visibleNodes(nodes, expanded).filter(
      (node) => node.depth > 0 && (settings.subtotals || !expanded.has(node.key) || !node.children.length),
    );
  const rows = visible(result.rowNodes, rowSet);
  const columns = visible(result.columnNodes, colSet);
  const rp = Math.min(rowPage, Math.max(0, Math.ceil(rows.length / 50) - 1));
  const cp = Math.min(columnPage, Math.max(0, Math.ceil(columns.length / 12) - 1));
  const rootRow = result.rowNodes.find((node) => node.depth === 0);
  const rootCol = result.columnNodes.find((node) => node.depth === 0);
  const shownRows = rows.slice(rp * 50, rp * 50 + 50);
  const shownCols = [...columns.slice(cp * 12, cp * 12 + 12), ...(rootCol ? [rootCol] : [])];
  const measureLabels = settings.pivot.measures.map((measure) =>
    measure.op === 'rows'
      ? t(OP_LABELS.rows)
      : `${t(dataset.measures.find((field) => field.key === measure.field)?.label)} / ${t(OP_LABELS[measure.op])}`,
  );
  const value = (row: PivotNode, col: PivotNode, index: number) => result.cells[cellKey(row.key, col.key)]?.[index];
  const cells = (row: PivotNode) =>
    shownCols.flatMap((col) =>
      settings.pivot.measures.map((_, index) => (
        <td key={`${col.key}-${index}`} className={col.depth === 0 ? 'analytics-total' : ''}>
          {value(row, col, index) === null || value(row, col, index) === undefined
            ? '—'
            : formatDecimal(value(row, col, index) ?? '')}
        </td>
      )),
    );
  const label = (node: PivotNode) =>
    node.depth === 0
      ? t({ ja: '総計', en: 'Grand total' })
      : node.path
          .map((part) =>
            part === null
              ? t({ ja: '未設定', en: 'Not set' })
              : part === ''
                ? t({ ja: '空文字', en: 'Empty text' })
                : shortAxisLabel(part),
          )
          .join(' / ');
  return (
    <div className="analytics-result" data-testid="pivot-result">
      <div className="analytics-result-tools">
        <span>
          {rows.length.toLocaleString()} {t({ ja: '行グループ', en: 'row groups' })} · {columns.length.toLocaleString()}{' '}
          {t({ ja: '列グループ', en: 'column groups' })}
        </span>
        <Paging
          page={rp}
          pages={Math.max(1, Math.ceil(rows.length / 50))}
          onChange={setRowPage}
          label={t({ ja: '行ページ', en: 'Row page' })}
        />
        {columns.length > 12 ? (
          <Paging
            page={cp}
            pages={Math.ceil(columns.length / 12)}
            onChange={setColumnPage}
            label={t({ ja: '列ページ', en: 'Column page' })}
          />
        ) : null}
      </div>
      <div
        className="analytics-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={t({ ja: 'ピボット集計表', en: 'Pivot table' })}
      >
        <table className="analytics-table">
          <thead>
            <tr>
              <th rowSpan={2} scope="col">
                {settings.pivot.rows
                  .map((axis) => t(dataset.dimensions.find((field) => field.key === axis.field)?.label))
                  .join(' → ') || t({ ja: '集計', en: 'Summary' })}
              </th>
              {shownCols.map((col) => (
                <th
                  key={col.key}
                  colSpan={settings.pivot.measures.length}
                  scope="colgroup"
                  className={col.depth === 0 ? 'analytics-total' : ''}
                  title={col.path.join(' / ')}
                >
                  {col.children.length && col.depth > 0 ? (
                    <button
                      type="button"
                      onClick={() => onExpand('columns', col.key)}
                      aria-expanded={colSet.has(col.key)}
                    >
                      {colSet.has(col.key) ? '−' : '＋'}{' '}
                      {col.path
                        .map((part) =>
                          shortAxisLabel(
                            part === null
                              ? t({ ja: '未設定', en: 'Not set' })
                              : part === ''
                                ? t({ ja: '空文字', en: 'Empty text' })
                                : part,
                          ),
                        )
                        .join(' / ')}
                    </button>
                  ) : col.depth > 0 ? (
                    col.path
                      .map((part) =>
                        shortAxisLabel(
                          part === null
                            ? t({ ja: '未設定', en: 'Not set' })
                            : part === ''
                              ? t({ ja: '空文字', en: 'Empty text' })
                              : part,
                        ),
                      )
                      .join(' / ')
                  ) : (
                    label(col)
                  )}
                </th>
              ))}
            </tr>
            <tr>
              {shownCols.flatMap((col) =>
                measureLabels.map((label, index) => (
                  <th scope="col" key={`${col.key}-${index}`}>
                    {label}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {shownRows.map((row) => (
              <tr key={row.key} className={row.children.length ? 'analytics-subtotal' : ''}>
                <th
                  scope="row"
                  title={row.path.join(' / ')}
                  style={{ paddingInlineStart: `${Math.max(0, row.depth - 1) * 18 + 12}px` }}
                >
                  {row.children.length ? (
                    <button type="button" aria-expanded={rowSet.has(row.key)} onClick={() => onExpand('rows', row.key)}>
                      {rowSet.has(row.key) ? '−' : '＋'} {label(row)}
                    </button>
                  ) : (
                    label(row)
                  )}
                </th>
                {cells(row)}
              </tr>
            ))}
          </tbody>
          {rootRow ? (
            <tfoot>
              <tr data-testid="pivot-grand-total">
                <th scope="row">{t({ ja: '全対象の総計', en: 'Grand total of all records' })}</th>
                {cells(rootRow)}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <p className="muted analytics-footnote">
        {t({
          ja: '総計は全取得データから再計算。ページや展開状態に左右されません。平均は有効値件数で加重し、小数部は入力精度と6桁の大きい方で丸めます。— は該当値なし。',
          en: 'Totals use all retrieved records, regardless of pages or expansion. Averages use valid source values and are rounded to the larger of the input scale and six decimal places. A dash means no value.',
        })}
      </p>
    </div>
  );
}
export function AnalyticsChart({
  result,
  settings,
  dataset,
}: {
  result: PivotResult;
  settings: AnalyticsSettings;
  dataset: AnalyticsDataset;
}) {
  const { t } = useLocale();
  if (settings.chart === 'none') return null;
  const measure = settings.pivot.measures[settings.chartMeasure] ?? settings.pivot.measures[0];
  if (!measure) return null;
  const index = Math.min(settings.chartMeasure, settings.pivot.measures.length - 1);
  // Leaf row groups partition the input, so chart points never double-count parent subtotals.
  const leaves = result.rowNodes.filter((node) => node.depth > 0 && !node.children.length);
  const shown = leaves
    .slice(0, 24)
    .map((node) => ({ node, exact: result.cells[cellKey(node.key, '[]')]?.[index] ?? null }));
  const values = shown.map((point) => (point.exact === null ? null : Number(point.exact)));
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const low = Math.min(0, ...finite);
  const high = Math.max(0, ...finite);
  const span = high - low || 1;
  const y = (value: number) => 220 - ((value - low) / span) * 180;
  const x = (at: number) => 65 + at * (560 / Math.max(shown.length, 1));
  const title =
    measure.op === 'rows'
      ? t(OP_LABELS.rows)
      : `${t(dataset.measures.find((field) => field.key === measure.field)?.label)} / ${t(OP_LABELS[measure.op])}`;
  return (
    <section className="analytics-chart" aria-label={title}>
      <div className="panel-heading">
        <h3>{title}</h3>
        <span className="status-pill">
          {t({ ja: '行の最下層・全列を対象に集計', en: 'Leaf rows across all columns' })}
        </span>
      </div>
      {shown.length ? (
        <>
          <svg
            viewBox="-80 0 880 400"
            role="img"
            aria-label={`${title} · ${shown.length} ${t({ ja: 'グループ', en: 'groups' })}`}
          >
            {[low, (high + low) / 2, high].map((value, index) => (
              <g key={index}>
                <line x1="58" x2="770" y1={y(value)} y2={y(value)} stroke="#dce4ee" />
                <text x="52" y={y(value) + 4} textAnchor="end" fontSize="10" fill="#64748b">
                  {chartScaleLabel(value)}
                </text>
              </g>
            ))}
            {shown.map((point, at) => {
              const numeric = values[at];
              if (numeric === null || numeric === undefined || !Number.isFinite(numeric)) return null;
              const prior = values[at - 1];
              return (
                <g key={point.node.key}>
                  <title>
                    {point.node.path.join(' / ')}: {point.exact}
                  </title>
                  {settings.chart === 'bar' ? (
                    <rect
                      x={x(at)}
                      y={Math.min(y(0), y(numeric))}
                      width={Math.max(4, 520 / Math.max(shown.length, 1))}
                      height={Math.max(1, Math.abs(y(numeric) - y(0)))}
                      rx="3"
                      fill={numeric < 0 ? '#ed708a' : '#6366f1'}
                    />
                  ) : (
                    <>
                      {at > 0 && prior !== null && prior !== undefined && Number.isFinite(prior) ? (
                        <line
                          x1={x(at - 1) + 8}
                          y1={y(prior)}
                          x2={x(at) + 8}
                          y2={y(numeric)}
                          stroke="#6366f1"
                          strokeWidth="3"
                        />
                      ) : null}
                      <circle cx={x(at) + 8} cy={y(numeric)} r="4" fill="#0ea5a0" />
                    </>
                  )}
                  <text
                    transform={`translate(${x(at) + 5},240) rotate(40)`}
                    className="analytics-point-label"
                    data-mobile-hidden={at % Math.ceil(shown.length / 6) !== 0}
                    fontSize="10"
                    fill="#475569"
                  >
                    {chartAxisLabel(point.node)}
                  </text>
                </g>
              );
            })}
          </svg>
          <p className="muted analytics-footnote">
            {t({
              ja: `軸の順序で先頭${shown.length} / ${leaves.length}グループを表示。省略分はグラフに含みません。数値の詳細は集計表で確認できます。`,
              en: `Showing the first ${shown.length} of ${leaves.length} groups in axis order. Omitted groups are not charted. Exact values are in the table.`,
            })}
          </p>
        </>
      ) : (
        <p className="muted">
          {t({ ja: '行の軸を選ぶとグラフを表示します。', en: 'Choose a row dimension to display a chart.' })}
        </p>
      )}
    </section>
  );
}
