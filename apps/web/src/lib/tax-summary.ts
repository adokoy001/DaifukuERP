import { isDecimalString, parseDecimalString } from './decimal.ts';
import type { FormValue } from './form.ts';

export interface TaxSummaryRow {
  category: string;
  label: string;
  rate: string;
  taxable: string;
  tax: string;
  gross: string;
}

/** Show stored amounts exactly; this display adapter never calculates taxes. */
export function parseTaxSummary(value: FormValue): TaxSummaryRow[] | undefined {
  if (typeof value !== 'string' || !value) return [];
  try {
    const rows: unknown = JSON.parse(value);
    if (!Array.isArray(rows)) return undefined;
    const result: TaxSummaryRow[] = [];
    for (const entry of rows) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined;
      const row = entry as Record<string, unknown>;
      if (
        typeof row.category !== 'string' ||
        !['rate', 'taxable', 'tax', 'gross'].every((key) => typeof row[key] === 'string' && isDecimalString(row[key]))
      )
        return undefined;
      result.push({
        category: row.category,
        label: typeof row.label === 'string' ? row.label : '',
        rate: String(row.rate),
        taxable: String(row.taxable),
        tax: String(row.tax),
        gross: String(row.gross),
      });
    }
    return result;
  } catch {
    return undefined;
  }
}

/** Decimal point shift, so 0.08 is 8% without floating point rounding. */
export function percentRate(value: string): string {
  const parsed = parseDecimalString(value);
  if (!parsed) return value;
  const digits = `${parsed.int}${parsed.frac.padEnd(2, '0')}`;
  const point = parsed.int.length + 2;
  const integer = digits.slice(0, point).replace(/^0+(?=\d)/, '');
  const fraction = digits.slice(point).replace(/0+$/, '');
  return `${parsed.neg ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}%`;
}
