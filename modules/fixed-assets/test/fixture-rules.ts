// Test rule set for the fixed-assets module (docs/specs/fixed-assets.md golden G1..G11). The rates are the candidate
// values of docs/domain/japan-fixed-assets.md#rate-tables (unverified); unit and DB tests pass them as arguments to
// check the arithmetic, independently of the l10n/jp data (which l10n/jp's own tests check against the schema).
import { Decimal, label } from '@daifuku/kernel';
import type { DepreciationRuleSet, Rate } from '../src/index.ts';

export const TEST_RULES: DepreciationRuleSet = {
  id: 'test-2026-10',
  country: 'JP',
  currency: 'JPY',
  verifiedOn: null,
  sources: ['https://laws.e-gov.go.jp/law/340M50000040015'],
  memorandum: [
    { kind: 'tangible', acquiredFrom: '2007-04-01', acquiredTo: null, amount: '1', source: 'test' },
    { kind: 'intangible', acquiredFrom: '2007-04-01', acquiredTo: null, amount: '0', source: 'test' },
  ],
  rateTables: [
    {
      method: 'straight_line',
      acquiredFrom: '2007-04-01',
      acquiredTo: null,
      source: 'test 別表第八',
      rows: [
        { usefulLife: 2, rate: '0.500', revisedRate: null, guaranteeRate: null },
        { usefulLife: 4, rate: '0.250', revisedRate: null, guaranteeRate: null },
        { usefulLife: 5, rate: '0.200', revisedRate: null, guaranteeRate: null },
        { usefulLife: 10, rate: '0.100', revisedRate: null, guaranteeRate: null },
        { usefulLife: 15, rate: '0.067', revisedRate: null, guaranteeRate: null },
      ],
    },
    {
      method: 'declining_200',
      acquiredFrom: '2012-04-01',
      acquiredTo: null,
      source: 'test 別表第十',
      rows: [
        { usefulLife: 2, rate: '1.000', revisedRate: null, guaranteeRate: null },
        { usefulLife: 4, rate: '0.500', revisedRate: '1.000', guaranteeRate: '0.12499' },
        { usefulLife: 5, rate: '0.400', revisedRate: '0.500', guaranteeRate: '0.10800' },
        { usefulLife: 10, rate: '0.200', revisedRate: '0.250', guaranteeRate: '0.06552' },
      ],
    },
  ],
  methodRestrictions: [
    {
      assetClass: 'building',
      acquiredFrom: '1998-04-01',
      acquiredTo: null,
      methods: ['straight_line'],
      source: 'test',
    },
    {
      assetClass: 'building_equipment',
      acquiredFrom: '2016-04-01',
      acquiredTo: null,
      methods: ['straight_line'],
      source: 'test',
    },
    {
      assetClass: 'structure',
      acquiredFrom: '2016-04-01',
      acquiredTo: null,
      methods: ['straight_line'],
      source: 'test',
    },
    {
      assetClass: 'software',
      acquiredFrom: '2007-04-01',
      acquiredTo: null,
      methods: ['straight_line'],
      source: 'test',
    },
  ],
  usefulLifeExamples: [
    { label: label('パソコン', 'Personal computer'), assetClass: 'tools_furniture', usefulLife: 4, table: '別表第一' },
  ],
  propertyTax: {
    assessmentMonth: 1,
    assessmentDay: 1,
    classes: [
      { code: 'structure', number: 1, label: label('構築物', 'Structures') },
      { code: 'machinery', number: 2, label: label('機械及び装置', 'Machinery and equipment') },
      { code: 'vessel', number: 3, label: label('船舶', 'Vessels') },
      { code: 'aircraft', number: 4, label: label('航空機', 'Aircraft') },
      { code: 'vehicle', number: 5, label: label('車両及び運搬具', 'Vehicles') },
      { code: 'tools', number: 6, label: label('工具、器具及び備品', 'Tools, furniture and fixtures') },
    ],
    defaultClass: {
      building: 'excluded',
      building_equipment: 'excluded',
      structure: 'structure',
      machinery: 'machinery',
      vehicle: 'excluded',
      tools_furniture: 'tools',
      software: 'excluded',
    },
    source: 'test 地方税法',
  },
};

export const rate = (r: string, revised: string | null = null, guarantee: string | null = null, life = 0): Rate => ({
  usefulLife: life,
  rate: Decimal.from(r),
  revisedRate: revised === null ? null : Decimal.from(revised),
  guaranteeRate: guarantee === null ? null : Decimal.from(guarantee),
});

export const SL5 = rate('0.200', null, null, 5);
/** G10, G11: 3 years (0.334), whose amounts are not whole yen before truncation. */
export const SL3 = rate('0.334', null, null, 3);
export const DB10 = rate('0.200', '0.250', '0.06552', 10);
export const DB5 = rate('0.400', '0.500', '0.10800', 5);
export const DB4 = rate('0.500', '1.000', '0.12499', 4);
export const DB2 = rate('1.000', null, null, 2);
/** G5: synthetic rates whose unadjusted amount equals the guarantee amount exactly in year 3. */
export const SYNTH = rate('0.5', '1.0', '0.125', 99);

/** Fiscal years (12 months) starting in `startMonth` from `firstYear` for `count` years. */
export function fiscalYears(firstYear: number, startMonth: number, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const y = firstYear + i;
    const start = `${y}-${String(startMonth).padStart(2, '0')}-01`;
    const endMonth = startMonth === 1 ? 12 : startMonth - 1;
    const endYear = startMonth === 1 ? y : y + 1;
    const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
    return {
      id: `FY${y}`,
      code: `FY${y}`,
      startDate: start,
      endDate: `${endYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      isClosed: false,
    };
  });
}
