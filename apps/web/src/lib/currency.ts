// Company currency -> minor units (ISO 4217) for the decimal display rule in lib/format.ts. Pure; currency.test.ts.
// web-phase15 AC-4: the currency comes from `GET /auth/me` `company.currency`; there is no hard-coded company currency.
// Until it is known (or when the request has no company) money keeps no minimum digits — only its significant ones.

/** Minimum digits when no currency is known: none padded, significant digits still shown (lib/format.ts AC-8). */
export const NO_CURRENCY_SCALE = 0;

/** ISO 4217 minor units of currencies that differ from the common 2, plus the ones the app is likely to meet. */
const MINOR_UNITS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  USD: 2,
  EUR: 2,
  GBP: 2,
  CNY: 2,
  AUD: 2,
  CAD: 2,
  SGD: 2,
  HKD: 2,
  TWD: 2,
  THB: 2,
  CHF: 2,
  BHD: 3,
  KWD: 3,
};

/** Most ISO 4217 currencies have 2 minor units; the kernel's currencyScale uses the same default for unknown codes. */
const ISO_DEFAULT_MINOR_UNITS = 2;

/** Fraction digits a money amount keeps on screen at least. Missing code (no company / not loaded yet) -> 0. */
export function currencyScale(code: string | null | undefined): number {
  const key = code?.trim().toUpperCase() ?? '';
  if (key === '') return NO_CURRENCY_SCALE;
  return MINOR_UNITS[key] ?? ISO_DEFAULT_MINOR_UNITS;
}

/** Tolerant reader for the currency of `GET /auth/me`: `company.currency` (kernel-phase15), or a top-level `currency`. */
export function currencyOf(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const rec = raw as Record<string, unknown>;
  const company = rec.company;
  if (typeof company === 'object' && company !== null) {
    const c = (company as Record<string, unknown>).currency;
    if (typeof c === 'string' && c) return c;
  }
  if (typeof rec.currency === 'string' && rec.currency) return rec.currency;
  return undefined;
}
