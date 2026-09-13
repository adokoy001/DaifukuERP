// Spec AC-1: for one category, validity periods must not overlap, so resolveRate is unambiguous for any date.
// Runs in before_validate on create and update; the merged (previous + patch) row is checked against every
// other row of the same category in the company. Also guards validTo >= validFrom and rate 0 for zero-rate categories.
import {
  Decimal,
  ValidationError,
  isLocalDate,
  registry,
  repo,
  withLock,
  type Context,
  type LocalDate,
} from '@daifuku/kernel';
import { TaxRate } from '../entities/tax-rate.ts';
import { isTaxCategory, isZeroRateCategory, type TaxCategory } from '../services/categories.ts';

type Raw = Record<string, unknown>;

interface Period {
  id: string | null;
  code: string;
  category: TaxCategory;
  validFrom: LocalDate;
  validTo: LocalDate | null;
}

/** Merged view of the row being written; null when the zod validation that follows will reject it anyway. */
function effective(row: Raw, previous: Raw | undefined): Period | null {
  const merged: Raw = { ...(previous ?? {}) };
  for (const [k, v] of Object.entries(row)) if (v !== undefined) merged[k] = v;
  const { category, validFrom, validTo, code } = merged;
  if (!isTaxCategory(category) || typeof validFrom !== 'string' || !isLocalDate(validFrom)) return null;
  if (validTo !== null && validTo !== undefined && (typeof validTo !== 'string' || !isLocalDate(validTo))) return null;
  return {
    id: typeof merged.id === 'string' ? merged.id : null,
    code: typeof code === 'string' ? code : '',
    category,
    validFrom,
    validTo: typeof validTo === 'string' ? validTo : null,
  };
}

function overlaps(a: Period, b: Period): boolean {
  return a.validFrom <= (b.validTo ?? '9999-12-31') && b.validFrom <= (a.validTo ?? '9999-12-31');
}

function assertRateForCategory(row: Raw, previous: Raw | undefined): void {
  const category = row.category ?? previous?.category;
  const rawRate = row.rate ?? previous?.rate;
  if (!isTaxCategory(category) || !isZeroRateCategory(category) || rawRate === undefined || rawRate === null) return;
  let rate: Decimal;
  try {
    rate = Decimal.from(rawRate as Decimal | string);
  } catch {
    return; // zod reports the malformed decimal
  }
  if (!rate.isZero()) {
    throw new ValidationError(
      `tax_rate: category ${category} must have rate 0`,
      [{ path: 'rate', message: `must be 0 for ${category}` }],
      '免税/非課税/不課税 are always rate 0; use category standard or reduced for a taxed rate.',
    );
  }
}

async function assertNoOverlap(ctx: Context, row: Raw, previous: Raw | undefined): Promise<void> {
  await withLock(ctx, 'tax-rates', async () => undefined);
  const me = effective(row, previous);
  if (!me) return;
  if (me.validTo !== null && me.validTo < me.validFrom) {
    throw new ValidationError(`tax_rate ${me.code}: validTo ${me.validTo} is before validFrom ${me.validFrom}`, [
      { path: 'validTo', message: 'must be on or after validFrom' },
    ]);
  }
  const others = await repo(ctx, TaxRate).list({
    where: {
      $and: [
        { category: me.category },
        { validFrom: { $lte: me.validTo ?? '9999-12-31' } },
        { $or: [{ validTo: null }, { validTo: { $gte: me.validFrom } }] },
        ...(me.id ? [{ id: { $ne: me.id } }] : []),
      ],
    },
    limit: 1,
  });
  for (const o of others.items) {
    if (o.id === me.id) continue;
    const other: Period = { id: o.id, code: o.code, category: o.category, validFrom: o.validFrom, validTo: o.validTo };
    if (!overlaps(me, other)) continue;
    throw new ValidationError(
      `tax_rate ${me.code || '(new)'}: period ${me.validFrom}〜${me.validTo ?? ''} overlaps ${o.code} (${o.validFrom}〜${o.validTo ?? ''}) for category ${me.category}`,
      [{ path: 'validFrom', message: `overlaps tax_rate ${o.code}` }],
      `Close the existing rate first (set validTo on ${o.code} to the day before this validFrom), then create the new one. Periods of one category must not overlap.`,
    );
  }
}

export function registerNoOverlapHook(): void {
  registry.registerHook('tax_rate', 'before_validate', async (ctx, { row, previous }) => {
    assertRateForCategory(row, previous);
    await assertNoOverlap(ctx, row, previous);
  });
}
