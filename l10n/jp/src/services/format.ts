// Display formatting for Japanese documents (spec AC-5). Input is Decimal or a decimal string — never a JS number
// (ADR-0010). Output is for humans only; never parse it back.
import { Decimal, ValidationError, type DecimalInput } from '@daifuku/kernel';

export { toHalfwidthKana } from '@daifuku/kernel';

function toDecimal(value: DecimalInput, path: string): Decimal {
  try {
    return Decimal.from(value);
  } catch (e) {
    throw new ValidationError(`${path}: not a decimal`, [
      { path, message: e instanceof Error ? e.message : String(e) },
    ]);
  }
}

/** Groups the integer part with commas; keeps the fractional digits the value carries ('1234567.5' → '1,234,567.5'). */
export function formatNumber(value: DecimalInput): string {
  const d = toDecimal(value, 'value');
  const s = d.abs().toString();
  const [int = '0', frac] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac === undefined ? grouped : `${grouped}.${frac}`;
  return d.isNegative() && !d.isZero() ? `-${body}` : body;
}

/** '3420' → '¥3,420'; negatives as '-¥1,000'. JPY has no minor unit, so nothing is rounded here (rounding is the caller's job). */
export function formatJpy(value: DecimalInput): string {
  const d = toDecimal(value, 'value');
  const body = formatNumber(d.abs());
  return d.isNegative() && !d.isZero() ? `-¥${body}` : `¥${body}`;
}

/** Rate '0.10' → '10%', '0.08' → '8%', '0.075' → '7.5%'. */
export function formatRatePercent(rate: DecimalInput): string {
  return `${toDecimal(rate, 'rate').times(100).toString()}%`;
}
