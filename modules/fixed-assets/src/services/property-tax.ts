// 償却資産申告の準備 (docs/specs/fixed-assets.md AC-22; D12). Pure: assets in, one row per municipality × class with the
// acquisition costs of 前年前 (held on B), 前年中減少, 前年中取得 and 計 (held on A). "Held on D" = acquired ≤ D and
// (not disposed, or disposed after D). 計 = 前年前 − 減少 + 取得 always holds.
import { Decimal, type LocalDate } from '@daifuku/kernel';

export interface PropertyTaxAsset {
  municipality: string | null;
  propertyTaxClass: string;
  acquisitionDate: LocalDate;
  disposedOn: LocalDate | null;
  cost: Decimal;
}

export interface PropertyTaxRow {
  municipality: string;
  propertyTaxClass: string;
  priorCost: Decimal;
  priorCount: number;
  decreaseCost: Decimal;
  decreaseCount: number;
  increaseCost: Decimal;
  increaseCount: number;
  totalCost: Decimal;
  totalCount: number;
}

export const UNSET_MUNICIPALITY = '（未設定）';

const heldOn = (a: PropertyTaxAsset, d: LocalDate): boolean =>
  a.acquisitionDate <= d && (a.disposedOn === null || a.disposedOn > d);

/** `previous` = B (last year's assessment date), `current` = A. Class order follows `classOrder`. */
export function propertyTaxRows(
  assets: readonly PropertyTaxAsset[],
  previous: LocalDate,
  current: LocalDate,
  classOrder: readonly string[],
): PropertyTaxRow[] {
  const rows = new Map<string, PropertyTaxRow>();
  for (const a of assets) {
    if (a.propertyTaxClass === 'excluded') continue;
    const prior = heldOn(a, previous);
    const now = heldOn(a, current);
    const decreased = prior && !now;
    const increased = !prior && now;
    if (!prior && !now) continue;
    const municipality = a.municipality?.trim() || UNSET_MUNICIPALITY;
    const key = `${municipality}\u0000${a.propertyTaxClass}`;
    const row = rows.get(key) ?? {
      municipality,
      propertyTaxClass: a.propertyTaxClass,
      priorCost: Decimal.zero(),
      priorCount: 0,
      decreaseCost: Decimal.zero(),
      decreaseCount: 0,
      increaseCost: Decimal.zero(),
      increaseCount: 0,
      totalCost: Decimal.zero(),
      totalCount: 0,
    };
    if (prior) {
      row.priorCost = row.priorCost.plus(a.cost);
      row.priorCount += 1;
    }
    if (decreased) {
      row.decreaseCost = row.decreaseCost.plus(a.cost);
      row.decreaseCount += 1;
    }
    if (increased) {
      row.increaseCost = row.increaseCost.plus(a.cost);
      row.increaseCount += 1;
    }
    if (now) {
      row.totalCost = row.totalCost.plus(a.cost);
      row.totalCount += 1;
    }
    rows.set(key, row);
  }
  const order = (c: string) => {
    const i = classOrder.indexOf(c);
    return i < 0 ? classOrder.length : i;
  };
  return [...rows.values()].sort(
    (x, y) =>
      (x.municipality === UNSET_MUNICIPALITY ? 1 : 0) - (y.municipality === UNSET_MUNICIPALITY ? 1 : 0) ||
      x.municipality.localeCompare(y.municipality, 'ja') ||
      order(x.propertyTaxClass) - order(y.propertyTaxClass),
  );
}
