// Recurring journal template (定期仕訳, docs/specs/recurring-journals.md AC-4). An always-editable master (not a
// document): `isActive` stops it, generation (accounting.generate_recurring) creates draft journal entries from it. Its
// lines are entity lines (ADR-0031): replace-all saved with the header, never frozen by docstatus. hooks/recurring.ts
// derives nextRunDate, checks the template (AC-7) and refuses changes that would rewrite generated history (AC-8).
import { defineEntity, f, label } from '@daifuku/kernel';
import {
  END_OF_MONTH,
  MAX_ALLOCATION_PERIODS,
  MIN_ALLOCATION_PERIODS,
  RECURRING_FREQUENCIES,
  RECURRING_KINDS,
} from '../services/recurrence.ts';
import { TAX_CATEGORIES, TAX_CATEGORY_LABELS } from './account.ts';

export { RECURRING_FREQUENCIES, RECURRING_KINDS };

export const RECURRING_KIND_LABELS = {
  fixed: label('定額', 'Fixed amount'),
  allocation: label('按分（前払費用など）', 'Allocation (prepaid expenses etc.)'),
} as const;
export const RECURRING_FREQUENCY_LABELS = {
  monthly: label('毎月', 'Monthly'),
  quarterly: label('3 か月ごと', 'Every 3 months'),
  yearly: label('毎年', 'Yearly'),
} as const;

export const RecurringJournal = defineEntity({
  name: 'recurring_journal',
  label: label('定期仕訳', 'Recurring journal'),
  fields: {
    name: f.text({ label: label('名称', 'Name'), required: true, maxLength: 100 }),
    description: f.text({
      label: label('摘要', 'Description'),
      description: label(
        '生成する仕訳の摘要（空なら名称）。按分では末尾に (k/N) が付きます',
        'Description of the generated entries (the name when empty); allocations append (k/N)',
      ),
      maxLength: 480,
    }),
    kind: f.enum(RECURRING_KINDS, {
      label: label('種類', 'Kind'),
      required: true,
      default: 'fixed',
      labels: RECURRING_KIND_LABELS,
    }),
    frequency: f.enum(RECURRING_FREQUENCIES, {
      label: label('周期', 'Frequency'),
      required: true,
      default: 'monthly',
      labels: RECURRING_FREQUENCY_LABELS,
    }),
    dayOfMonth: f.int({
      label: label('日', 'Day of month'),
      description: label(
        '1〜31。31 は月末、月の日数を超える日はその月の末日',
        '1 to 31; 31 means month end, a day past the month length falls on its last day',
      ),
      required: true,
      default: END_OF_MONTH,
      min: 1,
      max: END_OF_MONTH,
    }),
    startDate: f.date({ label: label('開始日', 'Start date'), required: true, default: 'today' }),
    endDate: f.date({
      label: label('終了日', 'End date'),
      description: label('この日より後の回は作りません', 'No occurrence after this date is generated'),
    }),
    allocationPeriods: f.int({
      label: label('按分回数', 'Allocation periods'),
      description: label('按分のときだけ（2〜120）', 'Allocations only (2 to 120)'),
      min: MIN_ALLOCATION_PERIODS,
      max: MAX_ALLOCATION_PERIODS,
    }),
    isActive: f.bool({ label: label('有効', 'Active'), required: true, default: true }),
    nextRunDate: f.date({
      label: label('次回日付', 'Next run date'),
      description: label(
        '開始日・周期・最後の生成日から自動で決まります',
        'Derived from the schedule and the last run',
      ),
      serverOwned: true,
    }),
    lastOccurrenceDate: f.date({
      label: label('最後の生成日', 'Last generated date'),
      description: label('最後に生成した回の日付', 'Date of the last generated occurrence'),
      serverOwned: true,
    }),
  },
  lines: [{ entity: 'recurring_journal_line', parentField: 'templateId' }],
  indexes: [['isActive', 'nextRunDate']],
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update', 'delete'],
      viewer: ['read'],
    },
  },
  views: {
    list: ['name', 'kind', 'frequency', 'nextRunDate', 'isActive', 'lastOccurrenceDate'],
    search: ['name', 'description'],
    // form-ergonomics AC-1: labelled sections (tabs on a narrow screen, 4 or more labelled groups).
    form: [
      { label: label('基本', 'Basics'), fields: ['name', 'description', 'isActive'] },
      { label: label('周期', 'Schedule'), fields: ['kind', 'frequency', 'dayOfMonth', 'startDate', 'endDate'] },
      { label: label('按分', 'Allocation'), fields: ['allocationPeriods'] },
      { label: label('生成の状況', 'Generation status'), fields: ['nextRunDate', 'lastOccurrenceDate'] },
    ],
  },
});

export const RecurringJournalLine = defineEntity({
  name: 'recurring_journal_line',
  label: label('定期仕訳明細', 'Recurring journal line'),
  fields: {
    templateId: f.ref('recurring_journal', {
      label: label('定期仕訳', 'Recurring journal'),
      required: true,
      onDelete: 'cascade',
    }),
    seq: f.int({ label: label('行番号', 'Seq'), required: true, default: 1, min: 1 }),
    accountId: f.ref('account', { label: label('勘定科目', 'Account'), required: true }),
    debit: f.money({ label: label('借方', 'Debit'), required: true, default: '0', min: '0' }),
    credit: f.money({ label: label('貸方', 'Credit'), required: true, default: '0', min: '0' }),
    partnerId: f.ref('partner', { label: label('取引先', 'Partner') }),
    taxCategory: f.enum(TAX_CATEGORIES, { label: label('税区分', 'Tax category'), labels: TAX_CATEGORY_LABELS }),
    taxRate: f.decimal({
      label: label('税率', 'Tax rate'),
      description: label('例: 0.10', 'e.g. 0.10'),
      scale: 4,
      min: '0',
    }),
    memo: f.text({ label: label('メモ', 'Memo'), maxLength: 200 }),
  },
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update', 'delete'],
      viewer: ['read'],
    },
  },
  views: { list: ['accountId', 'debit', 'credit', 'partnerId', 'taxCategory', 'taxRate', 'memo'] },
});

export type RecurringJournalDef = typeof RecurringJournal;
export type RecurringJournalLineDef = typeof RecurringJournalLine;
