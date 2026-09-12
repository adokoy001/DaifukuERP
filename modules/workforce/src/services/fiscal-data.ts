// Verified primary tables, frozen as a versioned rules snapshot. See japan-payroll-automation.md.
export const FISCAL_CODE = 'jp-2026-regular-20260912-v1';
export const FISCAL_SOURCES = [
  'https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/18.pdf',
  'https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/204.pdf',
  'https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/115.pdf',
  'https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/107.pdf',
  'https://www.nta.go.jp/users/gensen/2026kiso/pdf/0026005-024.pdf',
  'https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/rate_prefectures/r08/',
  'https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/002/',
  'https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/003/',
  'https://www.nenkin.go.jp/section/faq/kounen/hokenryo/20120329.html',
  'https://www.mhlw.go.jp/content/001692566.pdf',
  'https://jsite.mhlw.go.jp/yamagata-roudoukyoku/content/contents/002587832.pdf',
  'https://www.kyoukaikenpo.or.jp/assets/R8_44oita.pdf',
  'https://www.kyoukaikenpo.or.jp/shibu/ibaraki/public_relations/009/',
  'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1175.htm',
  'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1411.htm',
  'https://www.mhlw.go.jp/new-info/kobetu/roudou/gyousei/hoken/kakikata/dl/keizoku-21.pdf',
];
const rates2025 = '10.31,9.85,9.62,10.11,10.01,9.75,9.62,9.67,9.82,9.77,9.76,9.79,9.91,9.92,9.55,9.65,9.88,9.94,9.89,9.69,9.93,9.80,10.03,9.99,9.97,10.03,10.24,10.16,10.02,10.19,9.93,9.94,10.17,9.97,10.36,10.47,10.21,10.18,10.13,10.31,10.78,10.41,10.12,10.25,10.09,10.31,9.44'.split(',');
const rates2026 = '10.28,9.85,9.51,10.10,10.01,9.75,9.50,9.52,9.82,9.68,9.67,9.73,9.85,9.92,9.21,9.59,9.70,9.71,9.55,9.63,9.80,9.61,9.93,9.77,9.88,9.89,10.13,10.12,9.91,10.06,9.86,9.94,10.05,9.78,10.15,10.24,10.02,9.98,10.05,10.11,10.55,10.06,10.08,10.08,9.77,10.13,9.44'.split(',');
export const PENSION_GRADES = '88000,98000,104000,110000,118000,126000,134000,142000,150000,160000,170000,180000,190000,200000,220000,240000,260000,280000,300000,320000,340000,360000,380000,410000,440000,470000,500000,530000,560000,590000,620000,650000'.split(',');
export const HEALTH_GRADES = ['58000', '68000', '78000', ...PENSION_GRADES, ...'680000,710000,750000,790000,830000,880000,930000,980000,1030000,1090000,1150000,1210000,1270000,1330000,1390000'.split(',')];
export const MONTHLY_TAX_2026 = {
  from: '2026-01-01', to: '2026-12-31', method: 'ko-electronic-exception', dependent: 31667,
  salary: [{ to: 158333, rate: '0', fixed: 54167 }, { to: 299999, rate: '0.30', fixed: 6667 }, { to: 549999, rate: '0.20', fixed: 36667 }, { to: 708330, rate: '0.10', fixed: 91667 }, { to: null, rate: '0', fixed: 162500 }],
  basic: [[2120833, 48334], [2162499, 40000], [2204166, 26667], [2245833, 13334]],
  tax: [{ to: 162500, rate: '0.05105', offset: 0 }, { to: 275000, rate: '0.10210', offset: 8296 }, { to: 579166, rate: '0.20420', offset: 36374 }, { to: 750000, rate: '0.23483', offset: 54113 }, { to: 1500000, rate: '0.33693', offset: 130688 }, { to: 3333333, rate: '0.40840', offset: 237893 }, { to: null, rate: '0.45945', offset: 408061 }],
  taxRoundUnit: 10,
} as const;
export const ANNUAL_TAX_2026 = {
  year: 2026, applicableFrom: '2026-12-01', regularAdjustmentThrough: '2027-01-31', salaryLimit: 20000000, salaryClassUnit: 4000,
  salary: [{ to: 740999, rate: '0', offset: 0, classed: false }, { to: 2190999, rate: '1', offset: -740000, classed: false }, { to: 2192999, rate: '0', offset: 1451000, classed: false }, { to: 2195999, rate: '0', offset: 1453000, classed: false }, { to: 2199999, rate: '0', offset: 1456000, classed: false }, { to: 3599999, rate: '0.70', offset: -80000, classed: true }, { to: 6599999, rate: '0.80', offset: -440000, classed: true }, { to: 8499999, rate: '0.90', offset: -1100000, classed: false }, { to: 20000000, rate: '1', offset: -1950000, classed: false }],
  basic: [[4890000, 1040000], [6550000, 670000], [23500000, 620000], [24000000, 480000], [24500000, 320000], [25000000, 160000]],
  tax: [{ to: 1950000, rate: '0.05', offset: 0 }, { to: 3300000, rate: '0.10', offset: 97500 }, { to: 6950000, rate: '0.20', offset: 427500 }, { to: 9000000, rate: '0.23', offset: 636000 }, { to: 18000000, rate: '0.33', offset: 1536000 }, { to: 18050000, rate: '0.40', offset: 2796000 }],
  incomeAdjustment: { above: 8500000, cap: 10000000, rate: '0.10' }, taxableRoundUnit: 1000, taxRoundUnit: 100, reconstructionFactor: '1.021',
} as const;
export const DEDUCTIONS_2026 = {
  year: 2026, dependentIncomeLimit: 620000, dependentMinimumAge: 16, specificAgeFrom: 19, specificAgeTo: 22, elderlyAge: 70, childLifeAgeLimit: 23,
  spouseTaxpayerBands: [9000000, 9500000, 10000000], spouseOrdinary: [380000, 260000, 130000], spouseElderly: [480000, 320000, 160000],
  spouseSpecial: [[950000, 380000, 260000, 130000], [1000000, 360000, 240000, 120000], [1050000, 310000, 210000, 110000], [1100000, 260000, 180000, 90000], [1150000, 210000, 140000, 70000], [1200000, 160000, 110000, 60000], [1250000, 110000, 80000, 40000], [1300000, 60000, 40000, 20000], [1330000, 30000, 20000, 10000]],
  relativeOrdinary: 380000, relativeSpecific: 630000, relativeElderly: 480000, relativeCohabitingElderly: 580000,
  relativeSpecial: [[850000, 630000], [900000, 610000], [950000, 510000], [1000000, 410000], [1050000, 310000], [1100000, 210000], [1150000, 110000], [1200000, 60000], [1230000, 30000]],
  disability: { none: 0, ordinary: 270000, special: 400000, cohabiting_special: 750000 }, widow: 270000, singleParent: 350000, singleIncomeLimit: 5000000, student: 270000, studentIncomeLimit: 890000, studentNonWorkLimit: 100000,
  life: { oldUnit: 25000, modernUnit: 20000, childUnit: 30000, modernCombinedCap: 40000, childCombinedCap: 60000, totalCap: 120000 },
  earthquake: { cap: 50000, oldFirst: 10000, oldSecond: 20000, oldOffset: 5000, oldCap: 15000 },
} as const;
export const FISCAL_DATA = {
  code: FISCAL_CODE, taxYear: 2026, currency: 'JPY', verifiedOn: '2026-09-12', monthlyTax: MONTHLY_TAX_2026, annualTax: ANNUAL_TAX_2026, deductions: DEDUCTIONS_2026,
  monthlyMethod: '2026-ko-electronic-exception', annualMethod: '2026-december-amendment',
  monthlyValidFrom: '2026-01-01', monthlyValidTo: '2026-12-31', annualApplicableFrom: '2026-12-01',
  health: [{ from: '2025-12', to: '2026-02', percentages: rates2025 }, { from: '2026-03', to: '2026-12', percentages: rates2026 }],
  nursing: [{ from: '2025-12', to: '2026-02', percent: '1.59' }, { from: '2026-03', to: '2026-12', percent: '1.62' }],
  childSupportFrom: '2026-04', childSupportPercent: '0.23', pensionPercent: '18.3',
  employment: [{ from: '2025-12-01', to: '2026-03-31', general: '0.0055', agriculture_sake: '0.0065', construction: '0.0065' }, { from: '2026-04-01', to: '2026-12-31', general: '0.005', agriculture_sake: '0.006', construction: '0.006' }],
  healthGrades: HEALTH_GRADES, pensionGrades: PENSION_GRADES,
  insuranceRounding: 'payroll-deduction: fraction <= 0.50 down; > 0.50 up',
  monthlyTaxRounding: 'salary deduction ceiling yen, tax nearest ten yen', annualTaxRounding: 'taxable income floor thousand yen, final tax floor hundred yen',
};
