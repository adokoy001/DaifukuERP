import { useCurrencyScale } from '../api/company.tsx';
import type { Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import type { FormValue } from '../lib/form.ts';
import { formatDecimal } from '../lib/format.ts';
import { parseTaxSummary, percentRate } from '../lib/tax-summary.ts';

const CATEGORY_LABELS: Record<string, Label> = {
  standard: { ja: '標準税率', en: 'Standard rate' },
  reduced: { ja: '軽減税率', en: 'Reduced rate' },
  exempt: { ja: '免税', en: 'Zero rated' },
  non_taxable: { ja: '非課税', en: 'Non-taxable' },
  out_of_scope: { ja: '不課税', en: 'Outside scope' },
};

/** Name/shape convention: a read-only taxSummary is the stored per-rate invoice breakdown. */
export function TaxSummary({ id, value }: { id: string; value: FormValue }) {
  const { t } = useLocale();
  const scale = useCurrencyScale();
  const rows = parseTaxSummary(value);
  if (!rows)
    return (
      <pre id={id} className="overflow-x-auto rounded bg-neutral-50 p-3 text-xs">
        {typeof value === 'string' ? value : ''}
      </pre>
    );
  if (!rows.length)
    return (
      <p id={id} className="rounded bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
        {t({ ja: '明細を保存すると税率別の内訳を表示します', en: 'Save invoice lines to see the tax breakdown.' })}
      </p>
    );
  const headings = [
    { ja: '税区分', en: 'Category' },
    { ja: '税率', en: 'Rate' },
    { ja: '税抜金額', en: 'Net' },
    { ja: '税額', en: 'Tax' },
    { ja: '税込金額', en: 'Gross' },
  ];
  return (
    <div id={id} className="overflow-x-auto rounded-lg border border-indigo-100 bg-indigo-50/30">
      <table className="w-full text-sm" aria-label={t({ ja: '税率別内訳', en: 'Tax breakdown' })}>
        <thead>
          <tr className="bg-indigo-50 text-xs text-indigo-900">
            {headings.map((h, i) => (
              <th
                key={h.en}
                scope="col"
                className={`whitespace-nowrap px-3 py-2 font-medium ${i ? 'text-right' : 'text-left'}`}
              >
                {t(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.category}-${row.rate}-${index}`} className="border-t border-indigo-100/70">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {row.label || t(CATEGORY_LABELS[row.category], row.category)}
              </th>
              <td className="num whitespace-nowrap px-3 py-2 text-neutral-600">{percentRate(row.rate)}</td>
              <td className="num whitespace-nowrap px-3 py-2">{formatDecimal(row.taxable, scale)}</td>
              <td className="num whitespace-nowrap px-3 py-2">{formatDecimal(row.tax, scale)}</td>
              <td className="num whitespace-nowrap px-3 py-2 font-semibold text-indigo-900">
                {formatDecimal(row.gross, scale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
