// 日本の減価償却の規則データ (docs/specs/fixed-assets.md AC-10, AC-29, AC-35; docs/domain/japan-fixed-assets.md). Dated data
// for the module's override point fixed_assets.depreciation_rules: 定額法 (別表第八, 2007-04-01 以後の取得) and 200% 定率法
// (別表第十, 2012-04-01 以後の取得) rate tables, 備忘価額, method restrictions by asset class, useful-life examples and
// the 償却資産申告 data. The values are transcribed from docs/domain/japan-fixed-assets.md#rate-tables, which no session
// could compare with the primary sources yet (network denied on 2026-10-30): `verifiedOn` stays null, so the module
// refuses postings until a person compares the tables and records it (AC-35). Never mark rows verified without that.
import { label } from '@daifuku/kernel';
import type { DepreciationRuleSet, FixedAssetRulesOverrideKey, RateRow } from '@daifuku/mod-fixed-assets';

/** The module's override key (a string literal type checks it against the module without a runtime import). */
export const JAPAN_FIXED_ASSET_RULES_OVERRIDE: FixedAssetRulesOverrideKey = 'fixed_assets.depreciation_rules';

const S1 = 'https://laws.e-gov.go.jp/law/340M50000040015';
const S2 = 'https://laws.e-gov.go.jp/law/340CO0000000097';
const S4 = 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2106.htm';
const S6 = 'https://laws.e-gov.go.jp/law/325AC0000000226';

const sl = (usefulLife: number, rate: string): RateRow => ({
  usefulLife,
  rate,
  revisedRate: null,
  guaranteeRate: null,
});
const db = (usefulLife: number, rate: string, revisedRate: string | null, guaranteeRate: string | null): RateRow => ({
  usefulLife,
  rate,
  revisedRate,
  guaranteeRate,
});

/** 耐用年数省令 別表第八（平成19年4月1日以後に取得をされた減価償却資産の定額法の償却率表）. 【未確認】 */
export const JP_STRAIGHT_LINE_RATES: readonly RateRow[] = [
  sl(2, '0.500'),
  sl(3, '0.334'),
  sl(4, '0.250'),
  sl(5, '0.200'),
  sl(6, '0.167'),
  sl(7, '0.143'),
  sl(8, '0.125'),
  sl(9, '0.112'),
  sl(10, '0.100'),
  sl(11, '0.091'),
  sl(12, '0.084'),
  sl(13, '0.077'),
  sl(14, '0.072'),
  sl(15, '0.067'),
  sl(16, '0.063'),
  sl(17, '0.059'),
  sl(18, '0.056'),
  sl(19, '0.053'),
  sl(20, '0.050'),
  sl(21, '0.048'),
  sl(22, '0.046'),
  sl(23, '0.044'),
  sl(24, '0.042'),
  sl(25, '0.040'),
  sl(26, '0.039'),
  sl(27, '0.038'),
  sl(28, '0.036'),
  sl(29, '0.035'),
  sl(30, '0.034'),
  sl(31, '0.033'),
  sl(32, '0.032'),
  sl(33, '0.031'),
  sl(34, '0.030'),
  sl(35, '0.029'),
  sl(36, '0.028'),
  sl(37, '0.028'),
  sl(38, '0.027'),
  sl(39, '0.026'),
  sl(40, '0.025'),
  sl(41, '0.025'),
  sl(42, '0.024'),
  sl(43, '0.024'),
  sl(44, '0.023'),
  sl(45, '0.023'),
  sl(46, '0.022'),
  sl(47, '0.022'),
  sl(48, '0.021'),
  sl(49, '0.021'),
  sl(50, '0.020'),
];

/**
 * 耐用年数省令 別表第十（平成24年4月1日以後に取得をされた減価償却資産の定率法の償却率、改定償却率及び保証率の表）, 2..20 years.
 * Rows of 21 years and more are left out until they can be compared with the table (spec D11). 【未確認】
 */
export const JP_DECLINING_200_RATES: readonly RateRow[] = [
  db(2, '1.000', null, null),
  db(3, '0.667', '1.000', '0.11089'),
  db(4, '0.500', '1.000', '0.12499'),
  db(5, '0.400', '0.500', '0.10800'),
  db(6, '0.333', '0.334', '0.09911'),
  db(7, '0.286', '0.334', '0.08680'),
  db(8, '0.250', '0.334', '0.07909'),
  db(9, '0.222', '0.250', '0.07126'),
  db(10, '0.200', '0.250', '0.06552'),
  db(11, '0.182', '0.200', '0.05992'),
  db(12, '0.167', '0.200', '0.05566'),
  db(13, '0.154', '0.167', '0.05180'),
  db(14, '0.143', '0.167', '0.04854'),
  db(15, '0.133', '0.143', '0.04565'),
  db(16, '0.125', '0.143', '0.04294'),
  db(17, '0.118', '0.125', '0.04038'),
  db(18, '0.111', '0.112', '0.03884'),
  db(19, '0.105', '0.112', '0.03693'),
  db(20, '0.100', '0.112', '0.03486'),
];

export const JAPAN_FIXED_ASSET_RULES: DepreciationRuleSet = {
  id: 'jp-2026-10-30',
  country: 'JP',
  currency: 'JPY',
  verifiedOn: null,
  sources: [S1, S2, S4, S6],
  memorandum: [
    {
      kind: 'tangible',
      acquiredFrom: '2007-04-01',
      acquiredTo: null,
      amount: '1',
      source: '法人税法施行令 第61条（備忘価額 1 円）',
    },
    {
      kind: 'intangible',
      acquiredFrom: '2007-04-01',
      acquiredTo: null,
      amount: '0',
      source: '法人税法施行令 第48条の2（無形減価償却資産は残存価額なし）',
    },
  ],
  rateTables: [
    {
      method: 'straight_line',
      acquiredFrom: '2007-04-01',
      acquiredTo: null,
      source: '耐用年数省令 別表第八',
      rows: [...JP_STRAIGHT_LINE_RATES],
    },
    {
      method: 'declining_200',
      acquiredFrom: '2012-04-01',
      acquiredTo: null,
      source: '耐用年数省令 別表第十',
      rows: [...JP_DECLINING_200_RATES],
    },
  ],
  methodRestrictions: [
    {
      assetClass: 'building',
      acquiredFrom: '1998-04-01',
      acquiredTo: null,
      methods: ['straight_line'],
      source: '法人税法施行令 第48条の2',
    },
    {
      assetClass: 'building_equipment',
      acquiredFrom: '2016-04-01',
      acquiredTo: null,
      methods: ['straight_line'],
      source: '法人税法施行令 第48条の2',
    },
    {
      assetClass: 'structure',
      acquiredFrom: '2016-04-01',
      acquiredTo: null,
      methods: ['straight_line'],
      source: '法人税法施行令 第48条の2',
    },
    {
      assetClass: 'software',
      acquiredFrom: '2007-04-01',
      acquiredTo: null,
      methods: ['straight_line'],
      source: '法人税法施行令 第48条の2',
    },
  ],
  usefulLifeExamples: [
    {
      label: label('パーソナルコンピュータ（サーバー用を除く）', 'Personal computer (not a server)'),
      assetClass: 'tools_furniture',
      usefulLife: 4,
      table: '別表第一 器具及び備品',
    },
    {
      label: label('事務机・いす・キャビネット（主として金属製）', 'Office desk, chair, cabinet (mainly metal)'),
      assetClass: 'tools_furniture',
      usefulLife: 15,
      table: '別表第一 器具及び備品',
    },
    {
      label: label('事務机・いす・キャビネット（その他）', 'Office desk, chair, cabinet (other)'),
      assetClass: 'tools_furniture',
      usefulLife: 8,
      table: '別表第一 器具及び備品',
    },
    {
      label: label('自動車（小型車 0.66 リットル以下）', 'Car (small, 0.66 litres or less)'),
      assetClass: 'vehicle',
      usefulLife: 4,
      table: '別表第一 車両及び運搬具',
    },
    {
      label: label('自動車（その他）', 'Car (other)'),
      assetClass: 'vehicle',
      usefulLife: 6,
      table: '別表第一 車両及び運搬具',
    },
    {
      label: label('電気設備（その他）', 'Electrical installations (other)'),
      assetClass: 'building_equipment',
      usefulLife: 15,
      table: '別表第一 建物附属設備',
    },
    {
      label: label('冷暖房設備（冷凍機 22kW 以下）', 'Air conditioning (refrigerator 22 kW or less)'),
      assetClass: 'building_equipment',
      usefulLife: 13,
      table: '別表第一 建物附属設備',
    },
    {
      label: label('木造の事務所用建物', 'Wooden office building'),
      assetClass: 'building',
      usefulLife: 24,
      table: '別表第一 建物',
    },
    {
      label: label('鉄筋コンクリート造の事務所用建物', 'Reinforced concrete office building'),
      assetClass: 'building',
      usefulLife: 50,
      table: '別表第一 建物',
    },
    {
      label: label('ソフトウエア（その他）', 'Software (other)'),
      assetClass: 'software',
      usefulLife: 5,
      table: '別表第三',
    },
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
    source: '地方税法 第341条第4号・第359条・第383条（賦課期日 1 月 1 日、種類別明細の区分）',
  },
};

/** The override registered by registerJapanOverrides (`() => DepreciationRuleSet | null`). */
export function japanFixedAssetRules(): DepreciationRuleSet {
  return JAPAN_FIXED_ASSET_RULES;
}
