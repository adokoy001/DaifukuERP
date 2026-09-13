// Spec AC-8: Japanese consumption tax rates as data (rate × period), inserted only when the code is absent.
// Sources: docs/domain/japan-tax.md#消費税 (標準10% / 軽減8% since 2019-10-01). The 2014-04-01〜2019-09-30 standard 8%
// period is 国税庁 タックスアンサー No.6303 (消費税及び地方消費税の税率) — to be added to docs/domain with a check date.
import type { Context, InsertInput } from '@daifuku/kernel';
import { repo } from '@daifuku/kernel';
import { TaxRate } from '../entities/tax-rate.ts';

type TaxRateInsert = InsertInput<typeof TaxRate>;

export const SEED_TAX_RATES: readonly TaxRateInsert[] = [
  {
    code: 'STD8',
    category: 'standard',
    rate: '0.08',
    validFrom: '2014-04-01',
    validTo: '2019-09-30',
    label: '標準8%（2014-04〜2019-09）',
  },
  { code: 'STD10', category: 'standard', rate: '0.10', validFrom: '2019-10-01', validTo: null, label: '標準10%' },
  { code: 'RED8', category: 'reduced', rate: '0.08', validFrom: '2019-10-01', validTo: null, label: '軽減8%' },
  { code: 'EXEMPT', category: 'exempt', rate: '0', validFrom: '2019-10-01', validTo: null, label: '免税' },
  { code: 'NONTAX', category: 'non_taxable', rate: '0', validFrom: '2019-10-01', validTo: null, label: '非課税' },
  { code: 'OOS', category: 'out_of_scope', rate: '0', validFrom: '2019-10-01', validTo: null, label: '不課税' },
];

/** Idempotent per company: existing codes are left untouched (no audit churn on re-run). */
export async function seedTaxRates(ctx: Context): Promise<void> {
  const r = repo(ctx, TaxRate);
  const codes = SEED_TAX_RATES.map((t) => t.code);
  const existing = await r.list({ where: { code: { $in: codes } }, limit: codes.length });
  const present = new Set(existing.items.map((t) => t.code));
  for (const t of SEED_TAX_RATES) {
    if (present.has(t.code)) continue;
    await r.create(t);
  }
}
