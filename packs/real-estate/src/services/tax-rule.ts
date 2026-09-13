// Consumption-tax category of rental charges (docs/domain/real-estate.md#tax; spec AC-3). Pure: no DB, no clock.
//   住宅の貸付け（契約で住宅用と明らか、貸付期間 1 か月以上）: 家賃・共益費・返還しない礼金/更新料 → 非課税
//     (消費税法 別表第二 十三、国税庁 タックスアンサー No.6226 / No.6225)
//   事務所・店舗の家賃、駐車場（区画を貸すもの）→ 課税（標準税率）(No.6225, No.6226)
//   返還する敷金・保証金 → 資産の譲渡等の対価に当たらない（不課税）: 請求書に載せず 預り金 で扱う (No.6225)
// Rates are not here: the category resolves to a dated rate in modules/tax.
import type { LocalDate } from '@daifuku/kernel';
import type { TaxCategory } from '@daifuku/mod-tax';

export const UNIT_USAGES = ['residential', 'office', 'store', 'parking'] as const;
export type UnitUsage = (typeof UNIT_USAGES)[number];

export type RentTaxCategory = Extract<TaxCategory, 'standard' | 'non_taxable'>;

/** 返還する敷金（不課税）. Recorded on the deposit ledger and journal, never on an invoice. */
export const DEPOSIT_TAX_CATEGORY: TaxCategory = 'out_of_scope';

export function isUnitUsage(v: unknown): v is UnitUsage {
  return typeof v === 'string' && (UNIT_USAGES as readonly string[]).includes(v);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The last day of a one-month lease starting on `startDate` (11-11 → 12-10; 01-31 → 02-28; 03-01 → 03-31). */
export function oneMonthEnd(startDate: LocalDate): LocalDate {
  const y = Number(startDate.slice(0, 4));
  const m = Number(startDate.slice(5, 7));
  const d = Number(startDate.slice(8, 10));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  // same day next month, minus one day; a day past the next month's end clamps to it (the lease then ends on its last day)
  const sameDay = Math.min(d, daysInMonth(ny, nm));
  const end = new Date(Date.UTC(ny, nm - 1, sameDay));
  if (d <= daysInMonth(ny, nm)) end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

/** 貸付期間が 1 か月未満: a fixed end date before the last day of a one-month lease. Open-ended leases are not. */
export function isShortTerm(startDate: LocalDate, endDate: LocalDate | null): boolean {
  return endDate !== null && endDate < oneMonthEnd(startDate);
}

/**
 * Default tax category of a rental charge (rent, 共益費, key money, renewal fee) for a unit's usage: residential leases of
 * one month or more are non-taxable; everything else (office, store, parking, short-term residential) is standard.
 */
export function rentTaxCategory(
  usage: UnitUsage,
  term: { startDate: LocalDate; endDate: LocalDate | null } | null = null,
): RentTaxCategory {
  if (usage !== 'residential') return 'standard';
  if (term !== null && isShortTerm(term.startDate, term.endDate)) return 'standard';
  return 'non_taxable';
}

/** 課税売上 categories for the rent roll split (免税 is a taxable transfer at 0%); non_taxable / out_of_scope are not. */
export function isTaxableCategory(category: string): boolean {
  return category === 'standard' || category === 'reduced' || category === 'exempt';
}
