// TableResult renderer (web-phase1 AC-3, docs/conventions/reports.md): columns by kind, ref cells link to the record,
// totals row from `totals` (server-computed decimal strings, shown through the same decimal display rule as cells);
// totals that match no column are listed under the table as「合計」key/value pairs (web-phase15 AC-7).
import { Link } from '@tanstack/react-router';
import { useCurrencyScale } from '../api/company.tsx';
import type { FieldMeta, TableColumn, TableResult } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { formatDecimal, formatValue } from '../lib/format.ts';
import { columnTotals, extraTotals } from '../lib/report.ts';
import { S } from '../strings.ts';

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
  return (
    <div className="flex flex-col gap-2">
      <ReportGrid result={result} currencyScale={currencyScale} />
      <ExtraTotals result={result} currencyScale={currencyScale} />
    </div>
  );
}

function ReportGrid({ result, currencyScale }: { result: TableResult; currencyScale: number }) {
  const { t } = useLocale();
  return (
    <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
      <table className="w-full text-sm" data-testid="report-table">
        <thead className="bg-neutral-50 text-left text-xs text-neutral-600">
          <tr>
            {result.columns.map((col) => (
              <th key={col.key} scope="col" className={`border-b border-neutral-200 px-2 py-1.5 font-medium whitespace-nowrap ${alignOf(col) === 'right' ? 'text-right' : ''}`}>
                {t(col.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, result.columns.length)} className="px-2 py-6 text-center text-neutral-500">
                {t(S.reportEmpty)}
              </td>
            </tr>
          ) : (
            result.rows.map((row, i) => (
              <tr key={i} data-testid="report-row" className="border-b border-neutral-100 hover:bg-sky-50">
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
