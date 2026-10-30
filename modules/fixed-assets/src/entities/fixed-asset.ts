// 固定資産台帳 (docs/specs/fixed-assets.md AC-1..AC-5; D1). A company-scoped master, not a document: assets are
// imported in bulk at adoption (B5 CSV import). Once a posted run line or disposal exists the financial fields freeze
// (hooks/asset.ts). `status` / `depreciationStart` / `disposedOn` are written by the module only.
import { defineEntity, f, label } from '@daifuku/kernel';
import { ASSET_CLASSES, DEPRECIATION_METHODS, PROPERTY_TAX_CLASSES } from '../rules.ts';

export const ASSET_STATUSES = ['active', 'disposed'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_CLASS_LABELS = {
  building: label('建物', 'Building'),
  building_equipment: label('建物附属設備', 'Building equipment'),
  structure: label('構築物', 'Structure'),
  machinery: label('機械及び装置', 'Machinery and equipment'),
  vehicle: label('車両及び運搬具', 'Vehicles'),
  tools_furniture: label('工具、器具及び備品', 'Tools, furniture and fixtures'),
  software: label('ソフトウエア', 'Software'),
} as const;

export const METHOD_LABELS = {
  straight_line: label('定額法', 'Straight-line'),
  declining_200: label('定率法（200%）', 'Declining balance (200%)'),
} as const;

export const PROPERTY_TAX_CLASS_LABELS = {
  structure: label('構築物', 'Structures'),
  machinery: label('機械及び装置', 'Machinery and equipment'),
  vessel: label('船舶', 'Vessels'),
  aircraft: label('航空機', 'Aircraft'),
  vehicle: label('車両及び運搬具', 'Vehicles'),
  tools: label('工具、器具及び備品', 'Tools, furniture and fixtures'),
  excluded: label('対象外', 'Not reported'),
} as const;

export const FixedAsset = defineEntity({
  name: 'fixed_asset',
  label: label('固定資産', 'Fixed asset'),
  fields: {
    code: f.text({
      label: label('資産番号', 'Asset code'),
      required: true,
      unique: true,
      immutable: true,
      maxLength: 30,
      normalize: 'trim',
    }),
    name: f.text({ label: label('名称', 'Name'), required: true, maxLength: 200 }),
    assetClass: f.enum(ASSET_CLASSES, {
      label: label('資産の種類', 'Asset class'),
      required: true,
      labels: ASSET_CLASS_LABELS,
    }),
    acquisitionDate: f.date({ label: label('取得日', 'Acquisition date'), required: true, index: true }),
    inServiceDate: f.date({
      label: label('事業供用日', 'In-service date'),
      description: label('空欄の資産は未供用として償却しません', 'Empty: not in service yet, not depreciated'),
    }),
    cost: f.money({
      label: label('取得価額（税抜）', 'Acquisition cost (excl. tax)'),
      required: true,
      min: '0',
    }),
    method: f.enum(DEPRECIATION_METHODS, {
      label: label('償却方法', 'Depreciation method'),
      required: true,
      labels: METHOD_LABELS,
    }),
    usefulLife: f.int({ label: label('耐用年数', 'Useful life (years)'), required: true, min: 1, max: 100 }),
    assetAccountId: f.ref('account', { label: label('資産科目', 'Asset account'), required: true }),
    accumulatedAccountId: f.ref('account', {
      label: label('減価償却累計額科目', 'Accumulated depreciation account'),
      description: label(
        '空欄なら設定 fixed_assets.accounts から補完（ソフトウエアは資産科目＝直接法）',
        'Empty: filled from setting fixed_assets.accounts (software: the asset account, direct method)',
      ),
    }),
    expenseAccountId: f.ref('account', {
      label: label('減価償却費科目', 'Depreciation expense account'),
      description: label('空欄なら設定 fixed_assets.accounts から補完', 'Empty: filled from fixed_assets.accounts'),
    }),
    location: f.text({ label: label('設置場所', 'Location'), maxLength: 200 }),
    municipality: f.text({ label: label('所在市区町村', 'Municipality'), maxLength: 100, index: true }),
    propertyTaxClass: f.enum(PROPERTY_TAX_CLASSES, {
      label: label('償却資産申告の種類', 'Property tax class'),
      description: label('空欄なら資産の種類から補完', 'Empty: derived from the asset class'),
      labels: PROPERTY_TAX_CLASS_LABELS,
    }),
    openingDate: f.date({
      label: label('移行日', 'Opening date'),
      description: label(
        'システムで償却を始める会計期間の初日（移行時の累計を入れる場合）',
        'First day of the fiscal period from which the system books (with the opening accumulated depreciation)',
      ),
    }),
    openingAccumulatedDepreciation: f.money({
      label: label('移行時の償却累計', 'Opening accumulated depreciation'),
      min: '0',
    }),
    openingYearDepreciation: f.money({
      label: label('移行年度の計上済み償却', 'Depreciation already booked in the opening year'),
      min: '0',
    }),
    openingRevisedBase: f.money({
      label: label('移行時の改定取得価額', 'Opening revised base'),
      description: label('定率法で移行前に切り替わっている場合', 'Declining balance already switched'),
      min: '0',
    }),
    memo: f.text({ label: label('メモ', 'Memo'), multiline: true, maxLength: 1000 }),
    status: f.enum(ASSET_STATUSES, {
      label: label('状態', 'Status'),
      serverOwned: true,
      required: true,
      default: 'active',
      index: true,
      labels: { active: label('使用中', 'Active'), disposed: label('除却・売却済み', 'Disposed') },
    }),
    depreciationStart: f.date({ label: label('償却開始', 'Depreciation start'), serverOwned: true }),
    disposedOn: f.date({ label: label('除却・売却日', 'Disposed on'), serverOwned: true }),
  },
  displayField: 'name',
  indexes: [['status', 'assetClass']],
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update', 'delete', 'export'],
      viewer: ['read'],
    },
  },
  views: {
    list: ['code', 'name', 'assetClass', 'acquisitionDate', 'cost', 'method', 'usefulLife', 'status'],
    search: ['code', 'name', 'location', 'municipality', 'memo'],
    form: [
      { label: label('基本', 'Basics'), fields: ['code', 'name', 'assetClass', 'acquisitionDate', 'inServiceDate'] },
      { label: label('償却', 'Depreciation'), fields: ['cost', 'method', 'usefulLife'] },
      {
        label: label('勘定科目', 'Accounts'),
        fields: ['assetAccountId', 'accumulatedAccountId', 'expenseAccountId'],
      },
      {
        label: label('所在と申告', 'Location and property tax'),
        fields: ['location', 'municipality', 'propertyTaxClass'],
      },
      {
        label: label('移行', 'Opening values'),
        fields: ['openingDate', 'openingAccumulatedDepreciation', 'openingYearDepreciation', 'openingRevisedBase'],
      },
      { label: label('状態', 'Status'), fields: ['status', 'depreciationStart', 'disposedOn', 'memo'] },
    ],
  },
});

export type FixedAssetDef = typeof FixedAsset;
