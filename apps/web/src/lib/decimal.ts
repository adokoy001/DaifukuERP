// Decimal-string arithmetic for client-side footer sums (web-phase1 AC-2). Strings in, strings out, BigInt inside:
// no float ever touches an amount (ADR-0010). The server remains the source of truth ("参考値").

const DECIMAL_RE = /^([+-])?(\d*)(?:\.(\d*))?$/;

interface Parsed {
  neg: boolean;
  int: string;
  frac: string;
}

export function parseDecimalString(s: string): Parsed | undefined {
  const m = DECIMAL_RE.exec(s.trim());
  if (!m) return undefined;
  const int = m[2] ?? '';
  const frac = m[3] ?? '';
  if (int === '' && frac === '') return undefined;
  return { neg: m[1] === '-', int: int || '0', frac };
}

export function isDecimalString(s: string): boolean {
  return parseDecimalString(s) !== undefined;
}

function toScaled(p: Parsed, scale: number): bigint {
  const digits = `${p.int}${p.frac.padEnd(scale, '0')}`;
  const v = BigInt(digits);
  return p.neg ? -v : v;
}

function fromScaled(v: bigint, scale: number): string {
  const neg = v < 0n;
  const digits = (neg ? -v : v).toString().padStart(scale + 1, '0');
  const int = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale).replace(/0+$/, '');
  const body = frac ? `${int}.${frac}` : int;
  return neg && body !== '0' ? `-${body}` : body;
}

/** Exact sum of decimal strings; invalid/empty entries are ignored. Result has trailing zeros trimmed ("0" when nothing summed). */
export function sumDecimalStrings(values: readonly string[]): string {
  const parsed = values.map(parseDecimalString).filter((p): p is Parsed => p !== undefined);
  const scale = parsed.reduce((m, p) => Math.max(m, p.frac.length), 0);
  const total = parsed.reduce((acc, p) => acc + toScaled(p, scale), 0n);
  return fromScaled(total, scale);
}

export function addDecimalStrings(a: string, b: string): string {
  return sumDecimalStrings([a, b]);
}

/** a − b; undefined when either side is not a decimal string (web-phase15 AC-2 未配分). */
export function subtractDecimalStrings(a: string, b: string): string | undefined {
  const pb = parseDecimalString(b);
  if (!parseDecimalString(a) || !pb) return undefined;
  const negated = `${pb.neg ? '' : '-'}${pb.int}${pb.frac ? `.${pb.frac}` : ''}`;
  return sumDecimalStrings([a, negated]);
}

/** Sign of a − b (-1, 0, 1); undefined when either side is not a decimal string. */
export function compareDecimalStrings(a: string, b: string): -1 | 0 | 1 | undefined {
  const pa = parseDecimalString(a);
  const pb = parseDecimalString(b);
  if (!pa || !pb) return undefined;
  const scale = Math.max(pa.frac.length, pb.frac.length);
  const diff = toScaled(pa, scale) - toScaled(pb, scale);
  return diff === 0n ? 0 : diff < 0n ? -1 : 1;
}

/** The smaller of two decimal strings (as given); undefined when either is not a decimal string. */
export function minDecimalString(a: string, b: string): string | undefined {
  const c = compareDecimalStrings(a, b);
  return c === undefined ? undefined : c <= 0 ? a : b;
}
