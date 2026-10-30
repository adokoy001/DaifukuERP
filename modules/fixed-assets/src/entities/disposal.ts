// 除却・売却 (docs/specs/fixed-assets.md AC-17..AC-20; D8, D15). A document: submit posts the disposal-year
// depreciation, the removal of the asset and (for a sale) the proceeds, output tax and gain/loss as one journal entry.
// The computed fields are refreshed on every draft save and recomputed at submit (hooks/disposal.ts).
import { defineDocument, f, label } from '@daifuku/kernel';
import { TAX_CATEGORIES, TAX_CATEGORY_LABELS } from '@daifuku/mod-accounting';

export const DISPOSAL_KINDS = ['retirement', 'sale'] as const;
export type DisposalKind = (typeof DISPOSAL_KINDS)[number];

export const FixedAssetDisposal = defineDocument({
  name: 'fixed_asset_disposal',
  label: label('除却・売却', 'Fixed asset disposal'),
  naming: { type: 'sequence', prefix: 'FD-', period: 'year' },
  fields: {
    assetId: f.ref('fixed_asset', { label: label('資産', 'Asset'), required: true, immutable: true, index: true }),
    date: f.date({ label: label('日付', 'Date'), required: true, default: 'today', index: true }),
    kind: f.enum(DISPOSAL_KINDS, {
      label: label('区分', 'Kind'),
      required: true,
      default: 'retirement',
      labels: { retirement: label('除却', 'Retirement'), sale: label('売却', 'Sale') },
    }),
    proceeds: f.money({
      label: label('売却価額（税抜）', 'Proceeds (excl. tax)'),
      required: true,
      default: '0',
      min: '0',
    }),
    taxCategory: f.enum(TAX_CATEGORIES, {
      label: label('税区分', 'Tax category'),
      description: label('売却の既定は標準税率', 'Sales default to the standard rate'),
      labels: TAX_CATEGORY_LABELS,
    }),
    proceedsAccountId: f.ref('account', {
      label: label('売却代金の科目', 'Proceeds account'),
      description: label(
        '空欄なら設定「固定資産の転記科目」の売却代金の科目',
        'Empty: the proceeds account of the setting “Fixed asset posting accounts”',
      ),
    }),
    partnerId: f.ref('partner', { label: label('売却先', 'Buyer') }),
    memo: f.text({ label: label('メモ', 'Memo'), multiline: true, maxLength: 1000 }),
    taxRate: f.decimal({ label: label('税率', 'Tax rate'), serverOwned: true, scale: 4 }),
    taxAmount: f.money({ label: label('消費税', 'Tax'), serverOwned: true }),
    disposalYearDepreciation: f.money({ label: label('当年償却', 'Disposal-year depreciation'), serverOwned: true }),
    accumulatedDepreciation: f.money({
      label: label('除却時の償却累計', 'Accumulated depreciation'),
      serverOwned: true,
    }),
    bookValue: f.money({ label: label('帳簿価額', 'Book value'), serverOwned: true }),
    gain: f.money({ label: label('売却益', 'Gain'), serverOwned: true }),
    loss: f.money({ label: label('売却損・除却損', 'Loss'), serverOwned: true }),
    journalEntryId: f.ref('journal_entry', { label: label('仕訳', 'Journal entry'), serverOwned: true }),
  },
  displayField: 'memo',
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend', 'export'],
      viewer: ['read'],
    },
  },
  views: {
    list: ['date', 'assetId', 'kind', 'proceeds', 'bookValue', 'gain', 'loss', 'journalEntryId'],
    search: ['memo'],
    form: [
      { label: label('基本', 'Basics'), fields: ['assetId', 'date', 'kind', 'memo'] },
      { label: label('売却', 'Sale'), fields: ['proceeds', 'taxCategory', 'proceedsAccountId', 'partnerId'] },
      {
        label: label('計算結果', 'Computed'),
        fields: [
          'disposalYearDepreciation',
          'accumulatedDepreciation',
          'bookValue',
          'taxRate',
          'taxAmount',
          'gain',
          'loss',
          'journalEntryId',
        ],
      },
    ],
  },
});
