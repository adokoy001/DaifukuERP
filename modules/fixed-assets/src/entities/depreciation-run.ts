// 償却の実行 (docs/specs/fixed-assets.md AC-12, AC-13, AC-16; D5, D6, D18). One run = one journal entry for one fiscal
// period; its lines are the per-asset amounts. Every field is server-owned: runs are created only by
// fixed_assets.run_depreciation (generic create and duplicate are refused in hooks/run.ts). A line counts as booked
// while its run is submitted (docstatus 1); cancelling the run reverses the entry and frees the asset/period pair.
import { defineDocument, defineEntity, f, label } from '@daifuku/kernel';

export const DepreciationRun = defineDocument({
  name: 'depreciation_run',
  label: label('償却の実行', 'Depreciation run'),
  naming: { type: 'sequence', prefix: 'DR-', period: 'year' },
  fields: {
    periodId: f.ref('fiscal_period', {
      label: label('会計期間', 'Fiscal period'),
      serverOwned: true,
      required: true,
      index: true,
    }),
    fiscalYearId: f.ref('fiscal_year', { label: label('会計年度', 'Fiscal year'), serverOwned: true, required: true }),
    date: f.date({ label: label('計上日', 'Posting date'), serverOwned: true, required: true, index: true }),
    totalAmount: f.money({
      label: label('償却額の合計', 'Total depreciation'),
      serverOwned: true,
      required: true,
      default: '0',
    }),
    assetCount: f.int({ label: label('資産の件数', 'Assets'), serverOwned: true, required: true, default: 0 }),
    ruleSetId: f.text({ label: label('規則集合', 'Rule set'), serverOwned: true, maxLength: 100 }),
    journalEntryId: f.ref('journal_entry', { label: label('仕訳', 'Journal entry'), serverOwned: true }),
  },
  import: false,
  lines: [{ entity: 'depreciation_run_line', parentField: 'runId' }],
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update', 'submit', 'cancel', 'export'],
      viewer: ['read'],
    },
  },
  views: {
    list: ['date', 'periodId', 'totalAmount', 'assetCount', 'journalEntryId'],
    form: [
      { label: label('実行', 'Run'), fields: ['periodId', 'fiscalYearId', 'date', 'ruleSetId'] },
      { label: label('結果', 'Result'), fields: ['totalAmount', 'assetCount', 'journalEntryId'] },
    ],
  },
});

export const DepreciationRunLine = defineEntity({
  name: 'depreciation_run_line',
  label: label('償却の明細', 'Depreciation run line'),
  fields: {
    runId: f.ref('depreciation_run', {
      label: label('償却の実行', 'Depreciation run'),
      serverOwned: true,
      required: true,
      onDelete: 'cascade',
    }),
    seq: f.int({ label: label('行番号', 'Seq'), serverOwned: true, required: true, default: 1, min: 1 }),
    assetId: f.ref('fixed_asset', { label: label('資産', 'Asset'), serverOwned: true, required: true, index: true }),
    periodId: f.ref('fiscal_period', {
      label: label('会計期間', 'Fiscal period'),
      serverOwned: true,
      required: true,
      index: true,
    }),
    fiscalYearId: f.ref('fiscal_year', { label: label('会計年度', 'Fiscal year'), serverOwned: true, required: true }),
    date: f.date({ label: label('計上日', 'Posting date'), serverOwned: true, required: true }),
    amount: f.money({ label: label('償却額', 'Amount'), serverOwned: true, required: true, min: '0' }),
    annualAmount: f.money({ label: label('年額', 'Annual amount'), serverOwned: true, required: true }),
    expenseAccountId: f.ref('account', {
      label: label('減価償却費科目', 'Expense account'),
      serverOwned: true,
      required: true,
    }),
    accumulatedAccountId: f.ref('account', {
      label: label('累計額科目', 'Accumulated depreciation account'),
      serverOwned: true,
      required: true,
    }),
    basis: f.json({ label: label('計算根拠', 'Calculation basis'), serverOwned: true }),
  },
  audit: 'none',
  import: false,
  indexes: [['assetId', 'fiscalYearId']],
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update', 'delete', 'export'],
      viewer: ['read'],
    },
  },
  views: { list: ['seq', 'assetId', 'date', 'amount', 'annualAmount', 'expenseAccountId', 'accumulatedAccountId'] },
});
