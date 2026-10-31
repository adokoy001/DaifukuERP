// The Japanese depreciation rule set (docs/specs/fixed-assets.md AC-10, AC-29, AC-35; docs/domain/japan-fixed-assets.md).
// Checks the data against the module's contract only: the values themselves are unverified (verifiedOn null) until a
// person compares them with 耐用年数省令 別表第八・第十.
import { checkRules, depreciationRuleSetSchema, selectRate } from '@daifuku/mod-fixed-assets';
import { describe, expect, it } from 'vitest';
import { JAPAN_FIXED_ASSET_RULES, JP_DECLINING_200_RATES, JP_STRAIGHT_LINE_RATES } from '../src/index.ts';

describe('Japanese depreciation rules (AC-10, AC-29)', () => {
  it('AC-10: passes the module schema and is usable for a JP / JPY company only', () => {
    expect(depreciationRuleSetSchema.safeParse(JAPAN_FIXED_ASSET_RULES).success).toBe(true);
    expect(checkRules(JAPAN_FIXED_ASSET_RULES, { country: 'JP', currency: 'JPY' }).ok).toBe(true);
    expect(checkRules(JAPAN_FIXED_ASSET_RULES, { country: 'US', currency: 'USD' }).ok).toBe(false);
  });

  it('AC-35: ships unverified (verifiedOn null) with the primary-source URLs (e-Gov 耐用年数省令, 法人税法施行令, 地方税法)', () => {
    expect(JAPAN_FIXED_ASSET_RULES.verifiedOn).toBeNull();
    expect(JAPAN_FIXED_ASSET_RULES.sources).toEqual(
      expect.arrayContaining([
        'https://laws.e-gov.go.jp/law/340M50000040015',
        'https://laws.e-gov.go.jp/law/340CO0000000097',
        'https://laws.e-gov.go.jp/law/325AC0000000226',
      ]),
    );
  });

  it('AC-10: 定額法 2–50 years and 200% 定率法 2–20 years (no rows beyond what the domain document lists)', () => {
    expect(JP_STRAIGHT_LINE_RATES.map((r) => r.usefulLife)).toEqual(Array.from({ length: 49 }, (_, i) => i + 2));
    expect(JP_DECLINING_200_RATES.map((r) => r.usefulLife)).toEqual(Array.from({ length: 19 }, (_, i) => i + 2));
    expect(JP_DECLINING_200_RATES[0]).toEqual({ usefulLife: 2, rate: '1.000', revisedRate: null, guaranteeRate: null });
    for (const r of JP_DECLINING_200_RATES.slice(1)) expect(r.revisedRate && r.guaranteeRate).toBeTruthy();
  });

  it('AC-10: the golden rates (G1 5-year straight line, G2 10-year declining) come from the tables', () => {
    expect(selectRate(JAPAN_FIXED_ASSET_RULES, 'straight_line', 5, '2026-10-01')?.rate.toString()).toBe('0.2');
    const db10 = selectRate(JAPAN_FIXED_ASSET_RULES, 'declining_200', 10, '2026-01-01');
    expect([db10?.rate.toString(), db10?.revisedRate?.toString(), db10?.guaranteeRate?.toString()]).toEqual([
      '0.2',
      '0.25',
      '0.06552',
    ]);
    expect(selectRate(JAPAN_FIXED_ASSET_RULES, 'declining_200', 21, '2026-01-01')).toBeNull();
    expect(selectRate(JAPAN_FIXED_ASSET_RULES, 'declining_200', 10, '2012-03-31')).toBeNull();
  });

  it('AC-10: every useful-life example has a straight-line rate; property-tax classes are numbered 1–6', () => {
    for (const e of JAPAN_FIXED_ASSET_RULES.usefulLifeExamples)
      expect(
        selectRate(JAPAN_FIXED_ASSET_RULES, 'straight_line', e.usefulLife, '2026-01-01'),
        e.label.ja,
      ).not.toBeNull();
    expect(JAPAN_FIXED_ASSET_RULES.propertyTax.classes.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect([
      JAPAN_FIXED_ASSET_RULES.propertyTax.assessmentMonth,
      JAPAN_FIXED_ASSET_RULES.propertyTax.assessmentDay,
    ]).toEqual([1, 1]);
  });
});
