// TableResult renderer (web-phase1 AC-3, docs/conventions/reports.md): columns by kind, ref cells link to the record,
// totals row from `totals` (server-computed decimal strings, shown through the same decimal display rule as cells);
// totals that match no column are listed under the table as「合計」key/value pairs (web-phase15 AC-7).
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useState } from 'react';
import { useCurrencyScale } from '../api/company.tsx';
import type { FieldMeta, TableColumn, TableResult } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { formatDecimal, formatValue } from '../lib/format.ts';
import { columnTotals, extraTotals, reportRowsPage, type ReportRowsPage, type ReportSort } from '../lib/report.ts';
import { S } from '../strings.ts';
import './report-ux.css';

const NUMERIC = new Set(['decimal', 'int']);

function alignOf(col: TableColumn): 'left' | 'right' {
  return col.align ?? (NUMERIC.has(col.kind) ? 'right' : 'left');
}

/**
 * TableColumn -> the FieldMeta shape formatValue expects. TableColumn has no money flag, so decimal columns are shown as
 * amounts (company currency minimum digits; docs/conventions/ui.md) — JPY shows no padding either way.
 */
function asField(col: TableColumn): FieldMeta {
  const f: FieldMeta = { name: col.key, kind: col.kind, label: col.label, required: false, hasDefault: false, hidden: false, immutable: false };
  if (col.ref) f.ref = col.ref;
  if (col.kind === 'decimal') f.money = true;
  return f;
}

function Cell({ col, value, currencyScale }: { col: TableColumn; value: unknown; currencyScale: number }) {
  const { locale } = useLocale();
  const fmt = formatValue(asField(col), value, locale, { currencyScale });
  const cls = `px-2 py-1 whitespace-nowrap ${fmt.mono ? 'font-mono tabular-nums' : ''} ${alignOf(col) === 'right' ? 'text-right' : ''}`;
  if (col.kind === 'ref' && col.ref && typeof value === 'string' && value) {
    return (
      <td className={cls}>
        <Link to="/e/$entity/$id" params={{ entity: col.ref, id: value }} className="text-sky-700 hover:underline" title={value}>
          {fmt.text}
        </Link>
      </td>
    );
  }
  return <td className={cls}>{value === null || value === undefined ? '—' : fmt.text}</td>;
}

function TotalsRow({ result, currencyScale }: { result: TableResult; currencyScale: number }) {
  const { t, locale } = useLocale();
  const totals = columnTotals(result);
  if (Object.keys(totals).length === 0) return null;
  return (
    <tfoot className="border-t-2 border-neutral-300 bg-neutral-50 font-medium">
      <tr data-testid="report-totals">
        {result.columns.map((col, i) => {
          const v = totals[col.key];
          const text = v !== undefined ? formatValue(asField(col), v, locale, { currencyScale }).text : i === 0 ? t(S.sums) : '';
          return (
            <td key={col.key} data-total={col.key} className={`px-2 py-1 whitespace-nowrap ${alignOf(col) === 'right' ? 'num' : ''}`}>
              {text}
            </td>
          );
        })}
      </tr>
    </tfoot>
  );
}

/** AC-7: keys shown as the server sent them, values through the decimal display rule (non-decimal text unchanged). */
function ExtraTotals({ result, currencyScale }: { result: TableResult; currencyScale: number }) {
  const { t } = useLocale();
  const extra = extraTotals(result);
  if (extra.length === 0) return null;
  return (
    <section aria-label={t(S.sums)} data-testid="report-extra-totals" className="rounded border border-neutral-200 bg-white px-3 py-2">
      <h3 className="mb-1 text-xs font-semibold text-neutral-600">{t(S.sums)}</h3>
      <dl className="grid w-fit grid-cols-[auto_auto] gap-x-6 gap-y-0.5 text-sm">
        {extra.map(([key, value]) => (
          <div key={key} className="contents" data-total-key={key}>
            <dt className="font-mono text-xs text-neutral-600">{key}</dt>
            <dd className="num">{formatDecimal(value, currencyScale)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ReportTable({ result }: { result: TableResult }) {
  const currencyScale = useCurrencyScale();
  const { t, locale } = useLocale();
  const searchId = useId(), pageId = useId();
  const [query, setQuery] = useState(''), [page, setPage] = useState(0), [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<ReportSort>();
  useEffect(() => { setQuery(''); setSort(undefined); setPage(0); }, [result]);
  const view = useMemo(() => reportRowsPage(result, {
    query, ...(sort ? { sort } : {}), page, pageSize, locale,
    cellText: (column, value) => formatValue(asField(column), value, locale, { currencyScale }).text,
  }), [result, query, sort, page, pageSize, locale, currencyScale]);
  const sortBy = (key: string) => {
    setSort((current) => current?.key !== key ? { key, direction: 'asc' } : current.direction === 'asc' ? { key, direction: 'desc' } : undefined);
    setPage(0);
  };
  const totalsPresent = Object.keys(result.totals ?? {}).length > 0;
  return (
    <div className="flex flex-col gap-2 report-browse">
      <div className="report-browse-toolbar">
        <label htmlFor={searchId}>{t({ ja: '結果内を検索', en: 'Search returned rows' })}<input id={searchId} className="input" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder={t({ ja: '名称・日付・金額など', en: 'Name, date, amount…' })} /></label>
        <label>{t({ ja: '1ページの行数', en: 'Rows per page' })}<select className="input" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }}><option value={25}>25</option><option value={50}>50</option></select></label>
        {sort ? <button type="button" className="btn" onClick={() => { setSort(undefined); setPage(0); }}>{t({ ja: '帳票の順序に戻す', en: 'Restore report order' })}</button> : null}
      </div>
      <p className="report-browse-note" role="status" data-testid="report-visible-count">{t({ ja: `受信 ${view.total.toLocaleString()} 行 · 一致 ${view.matched.toLocaleString()} 行 · ${view.from.toLocaleString()}–${view.to.toLocaleString()} 行を表示`, en: `${view.total.toLocaleString()} returned · ${view.matched.toLocaleString()} matching · showing ${view.from.toLocaleString()}–${view.to.toLocaleString()}` })}</p>
      {totalsPresent ? <p className="report-browse-note">{t({ ja: '合計欄は受信した帳票全体の集計値です。検索やページ移動では変わりません。CSV出力にも帳票全体が含まれます。', en: 'Totals describe the returned report and do not change with search or pagination. CSV export also includes the full report.' })}</p> : null}
      <ReportGrid result={result} view={view} sort={sort} sortBy={sortBy} currencyScale={currencyScale} />
      <nav aria-label={t({ ja: '帳票結果のページ移動', en: 'Report pagination' })} className="report-browse-pages">
        <button type="button" className="btn" disabled={view.page === 0} onClick={() => setPage(0)}>{t({ ja: '最初', en: 'First' })}</button>
        <button type="button" className="btn" disabled={view.page === 0} onClick={() => setPage(view.page - 1)}>{t({ ja: '前へ', en: 'Previous' })}</button>
        <label htmlFor={pageId}>{t({ ja: 'ページ', en: 'Page' })}<input id={pageId} className="input report-page-number" type="number" min={1} max={view.pages} value={view.page + 1} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1) setPage(Math.min(view.pages, value) - 1); }} /> / {view.pages.toLocaleString()}</label>
        <button type="button" className="btn" disabled={view.page + 1 >= view.pages} onClick={() => setPage(view.page + 1)}>{t({ ja: '次へ', en: 'Next' })}</button>
        <button type="button" className="btn" disabled={view.page + 1 >= view.pages} onClick={() => setPage(view.pages - 1)}>{t({ ja: '最後', en: 'Last' })}</button>
      </nav>
      <ExtraTotals result={result} currencyScale={currencyScale} />
    </div>
  );
}

function ReportGrid({ result, view, sort, sortBy, currencyScale }: { result: TableResult; view: ReportRowsPage; sort: ReportSort | undefined; sortBy: (key: string) => void; currencyScale: number }) {
  const { t } = useLocale();
  return (
    <div className="overflow-x-auto rounded border border-neutral-200 bg-white report-browse-grid">
      <table className="w-full text-sm" data-testid="report-table">
        <thead className="bg-neutral-50 text-left text-xs text-neutral-600">
          <tr>
            {result.columns.map((col) => (
              <th key={col.key} scope="col" aria-sort={sort?.key === col.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'} className={`border-b border-neutral-200 px-2 py-1.5 font-medium whitespace-nowrap ${alignOf(col) === 'right' ? 'text-right' : ''}`}>
                <button type="button" className="report-sort-button" onClick={() => sortBy(col.key)} title={t({ ja: '昇順 → 降順 → 帳票の順序', en: 'Ascending → descending → report order' })}>{t(col.label)} <span aria-hidden="true">{sort?.key === col.key ? sort.direction === 'asc' ? '↑' : '↓' : '↕'}</span></button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, result.columns.length)} className="px-2 py-6 text-center text-neutral-500">
                {result.rows.length === 0 ? t(S.reportEmpty) : t({ ja: '検索条件に一致する行がありません。', en: 'No rows match your search.' })}
              </td>
            </tr>
          ) : (
            view.rows.map(({ row, index }) => (
              <tr key={index} data-testid="report-row" className="border-b border-neutral-100 hover:bg-sky-50">
                {result.columns.map((col) => (
                  <Cell key={col.key} col={col} value={row[col.key]} currencyScale={currencyScale} />
                ))}
              </tr>
            ))
          )}
        </tbody>
        <TotalsRow result={result} currencyScale={currencyScale} />
      </table>
    </div>
  );
}
