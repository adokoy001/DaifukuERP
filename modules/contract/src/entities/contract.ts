// Contract header (継続契約, spec AC-1). `status` and `nextPeriod` are system-owned: hooks/recalc.ts keeps them 'draft'/null
// on drafts and re-derives them on every update of a submitted contract (status from endDate and today, nextPeriod from
// the contract_billing ledger), hooks/submit.ts and hooks/cancel.ts set them at the transitions. After submit only
// endDate (contract.end), status and nextPeriod may change (allowOnSubmit); lines are frozen (hooks/lines.ts).
import { defineDocument, f, label, type RoundingMode } from '@daifuku/kernel';
import { BILLING_TIMINGS, PERIOD_PATTERN } from '../services/periods.ts';
import { PRORATION_RULES } from '../services/proration.ts';

export const CONTRACT_STATUSES = ['draft', 'active', 'ended', 'cancelled'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** Kernel rounding modes as an enum tuple (the DSL needs a non-empty literal tuple). */
export const CONTRACT_ROUNDING_MODES = ['half_up', 'down', 'up'] as const satisfies readonly RoundingMode[];

const ALL_OPS = ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend', 'export'] as const;

export const Contract = defineDocument({
  name: 'contract',
  label: label('契約', 'Contract'),
  naming: { type: 'sequence', prefix: 'CTR-', period: 'year' },
  fields: {
    partnerId: f.ref('partner', { label: label('取引先', 'Customer'), required: true, index: true }),
    title: f.text({ label: label('件名', 'Title'), required: true, maxLength: 200 }),
    startDate: f.date({ label: label('開始日', 'Start date'), required: true }),
    endDate: f.date({
      label: label('終了日', 'End date'),
      description: label('空欄は期間の定めなし。submit 後は contract.end で設定', 'Empty = open-ended. After submit, set it with contract.end'),
    }),
    billingDay: f.int({
      label: label('請求日', 'Billing day'),
      description: label('請求書の日付（1〜31、31 = 月末。月の日数を超える日は月末）', 'Invoice day of month (1–31; 31 = end of month, clamped to the month length)'),
      required: true,
      default: 1,
      min: 1,
      max: 31,
    }),
    billingTiming: f.enum(BILLING_TIMINGS, {
      label: label('請求タイミング', 'Billing timing'),
      required: true,
      default: 'advance',
      labels: { advance: label('前払い（当月分を当月請求）', 'In advance (month billed in the month)'), arrears: label('後払い（当月分を翌月請求）', 'In arrears (month billed in the next month)') },
    }),
    intervalMonths: f.int({
      label: label('請求間隔（月）', 'Billing interval (months)'),
      description: label('1 請求でまとめる月数。単価は月額', 'Months billed per invoice; unit prices are monthly'),
      required: true,
      default: 1,
      min: 1,
      max: 12,
    }),
    prorationRule: f.enum(PRORATION_RULES, {
      label: label('日割り', 'Proration'),
      description: label('省略時は会社設定 contract.default_proration', 'Defaults to the company setting contract.default_proration'),
      required: true,
      default: 'daily',
      labels: { daily: label('日割り（当月の実日数）', 'Daily (actual days of the month)'), none: label('日割りなし（開始月・終了月も満額）', 'None (full price in the first and last month)') },
    }),
    roundingMode: f.enum(CONTRACT_ROUNDING_MODES, {
      label: label('日割りの端数処理', 'Proration rounding'),
      required: true,
      default: 'down',
      labels: { half_up: label('四捨五入', 'Half up'), down: label('切捨て', 'Down'), up: label('切上げ', 'Up') },
    }),
    status: f.enum(CONTRACT_STATUSES, { serverOwned: true,
      label: label('状態', 'Status'),
      required: true,
      default: 'draft',
      labels: { draft: label('下書き', 'Draft'), active: label('契約中', 'Active'), ended: label('終了', 'Ended'), cancelled: label('取消', 'Cancelled') },
    }),
    nextPeriod: f.text({ serverOwned: true,
      label: label('次回請求対象月', 'Next billing period'),
      description: label('請求書をまだ作っていない最も早い対象月（YYYY-MM、自動計算）', 'Earliest billing period without an invoice (YYYY-MM, computed)'),
      pattern: PERIOD_PATTERN,
      maxLength: 7,
    }),
    note: f.text({ label: label('備考', 'Note'), multiline: true, maxLength: 2000 }),
  },
  allowOnSubmit: ['endDate', 'status', 'nextPeriod'],
  lines: [{ entity: 'contract_line', parentField: 'contractId' }],
  indexes: [['status', 'partnerId']],
  displayField: 'title',
  permissions: {
    roles: {
      sales: ALL_OPS,
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: {
    list: ['partnerId', 'title', 'startDate', 'endDate', 'status', 'nextPeriod'],
    search: ['title', 'note'],
    form: [
      ['partnerId', 'title'],
      ['startDate', 'endDate', 'status', 'nextPeriod'],
      ['billingDay', 'billingTiming', 'intervalMonths'],
      ['prorationRule', 'roundingMode'],
      ['note'],
    ],
  },
});

export type ContractDef = typeof Contract;
