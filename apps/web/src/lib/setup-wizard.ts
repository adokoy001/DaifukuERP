// Pure helpers of the setup wizard (docs/specs/setup-wizard.md): the response types of GET /meta/setup-status, the step
// opened first, the fiscal year proposal (AC-3), merging a change into the stored setup.progress (AC-6, AC-15), which
// record actions a step offers, whether the home card shows (AC-7), the stepper's keyboard targets (AC-10), the
// inventory choice (AC-4) and copying the issuer from the company profile (AC-20). No React, no fetching.
import type { Label } from '../api/types.ts';

export const SETUP_STEP_IDS = [
  'company_profile',
  'fiscal_year',
  'chart_of_accounts',
  'tax',
  'invoice_issuer',
  'inventory',
  'industry_template',
  'users',
  'workforce',
] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];
export type SetupStepStatus = 'done' | 'todo' | 'skipped';
export type SetupCheckStatus = 'ok' | 'warn' | 'fail';

export interface SetupCheck {
  id: string;
  status: SetupCheckStatus;
  label: Label;
  detail: Label;
  href?: string;
}
export interface SetupStep {
  id: SetupStepId;
  order: number;
  label: Label;
  optional: boolean;
  status: SetupStepStatus;
  reason?: string;
  skippedAt?: string;
  completedAt?: string;
  regressed: boolean;
  checks: SetupCheck[];
}
export interface SetupSummary {
  required: number;
  done: number;
  skipped: number;
  remaining: number;
  nextStep: SetupStepId | null;
  attention: SetupStepId[];
}
export type SetupStepRecord = { state: 'completed'; at: string } | { state: 'skipped'; at: string; reason: string };
export type SetupProgress = Partial<Record<SetupStepId, SetupStepRecord>> & { updatedAt?: string };
export interface SetupStatus {
  checkedAt: string;
  steps: SetupStep[];
  summary: SetupSummary;
  progress: SetupProgress;
}

export function isSetupStepId(value: unknown): value is SetupStepId {
  return typeof value === 'string' && (SETUP_STEP_IDS as readonly string[]).includes(value);
}

/** `?step=` of /setup (router validateSearch): a known step id, anything else is dropped. */
export function parseSetupSearch(raw: Record<string, unknown>): { step?: SetupStepId } {
  return isSetupStepId(raw.step) ? { step: raw.step } : {};
}

/** AC-1: the requested step when the response has it, else the first required todo step, else the first step. */
export function initialStep(status: SetupStatus | undefined, requested: SetupStepId | undefined): SetupStepId {
  if (requested && (!status || status.steps.some((step) => step.id === requested))) return requested;
  return status?.summary.nextStep ?? status?.steps[0]?.id ?? SETUP_STEP_IDS[0];
}

/** The step before (-1) or after (+1) `current` in the response's order, or undefined at either end. */
export function neighbourStep(
  steps: readonly SetupStep[],
  current: SetupStepId,
  delta: -1 | 1,
): SetupStepId | undefined {
  const index = steps.findIndex((step) => step.id === current);
  return index < 0 ? undefined : steps[index + delta]?.id;
}

export function isAdminRoles(roles: readonly string[] | undefined): boolean {
  return (roles ?? []).includes('admin');
}

// ---- setup.progress (AC-6, AC-11, AC-15) ----

export const SKIP_REASON_MAX = 200;

export type ProgressChange =
  | { step: SetupStepId; record: 'completed' }
  | { step: SetupStepId; record: 'skipped'; reason: string }
  | { step: SetupStepId; record: null };

/**
 * The value to PUT: the stored record from the latest status (`progress`, which also holds steps this runtime does not
 * return) with one step changed. A completed record replaces a skip of the same step; `null` removes the record.
 */
export function buildProgress(progress: SetupProgress, change: ProgressChange, now: Date): SetupProgress {
  const at = now.toISOString();
  const next: SetupProgress = { ...progress };
  if (change.record === null) delete next[change.step];
  else if (change.record === 'completed') next[change.step] = { state: 'completed', at };
  else next[change.step] = { state: 'skipped', at, reason: change.reason.trim() };
  next.updatedAt = at;
  return next;
}

/** AC-15: "confirm and next" writes a completed record only while the step is done. */
export function canConfirm(step: SetupStep): boolean {
  return step.status === 'done';
}

/** AC-15: a skip is offered only while the step is todo. */
export function canSkip(step: SetupStep): boolean {
  return step.status === 'todo';
}

/** AC-6: "undo skip" whenever a skip record exists (also on a step that has become done). */
export function canUndoSkip(step: SetupStep): boolean {
  return step.skippedAt !== undefined;
}

/** AC-26: the reason is required and at most 200 characters after trimming. */
export function skipReasonError(text: string): Label | null {
  const trimmed = text.trim();
  if (trimmed === '') return { ja: 'スキップする理由を入力してください。', en: 'Enter why you skip this step.' };
  if (trimmed.length > SKIP_REASON_MAX)
    return {
      ja: `理由は ${SKIP_REASON_MAX} 文字以内にしてください（現在 ${trimmed.length} 文字）。`,
      en: `Keep the reason within ${SKIP_REASON_MAX} characters (now ${trimmed.length}).`,
    };
  return null;
}

// ---- home card (AC-7) ----

/** AC-7: shown while a required step is todo, or any step has a failing check (skipped or not). */
export function showSetupCard(status: SetupStatus): boolean {
  return status.summary.remaining > 0 || status.summary.attention.length > 0;
}

/** AC-7: the step the card links to: the next required todo step, else the first step with a failing check. */
export function cardTarget(status: SetupStatus): SetupStepId | null {
  return status.summary.nextStep ?? status.summary.attention[0] ?? null;
}

export function progressText(summary: SetupSummary): Label {
  const skippedJa = summary.skipped > 0 ? `、スキップ ${summary.skipped}` : '';
  const skippedEn = summary.skipped > 0 ? `, ${summary.skipped} skipped` : '';
  return {
    ja: `${summary.required} 段階中 ${summary.done} 段階完了${skippedJa}`,
    en: `${summary.done} of ${summary.required} steps done${skippedEn}`,
  };
}

// ---- stepper keyboard (AC-10) ----

/** Arrow keys move to the neighbour (wrapping like the kit's tabs), Home / End to the ends; other keys do nothing. */
export function stepperKeyTarget(key: string, index: number, count: number): number | undefined {
  if (count === 0) return undefined;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const delta = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (delta === 0) return undefined;
  return (((index + delta) % count) + count) % count;
}

export const STEP_STATUS_TEXT: Record<SetupStepStatus, Label> = {
  done: { ja: '完了', en: 'Done' },
  todo: { ja: '未完了', en: 'To do' },
  skipped: { ja: 'スキップ', en: 'Skipped' },
};
export const STEP_STATUS_TONE: Record<SetupStepStatus, 'success' | 'warning' | 'neutral'> = {
  done: 'success',
  todo: 'warning',
  skipped: 'neutral',
};
export const OPTIONAL_TEXT: Label = { ja: '任意', en: 'Optional' };

// ---- fiscal year (AC-3) ----

export interface FiscalYearRow {
  id?: string;
  code: string;
  startDate: string;
  endDate: string;
}
export interface FiscalProposal {
  startDate: string;
  endDate: string;
  /** Continues the latest year (starts the day after it ends). */
  continuation: boolean;
  /** The start month is not the month after the year-end month. */
  mismatch: boolean;
  /** An existing year the proposal overlaps: no create action then. */
  overlap?: FiscalYearRow;
  /** Days between the previous year and the proposal: documents dated then cannot be submitted. */
  gap?: { from: string; to: string };
}
export type FiscalPlan =
  | { kind: 'current'; current: FiscalYearRow; mismatch: boolean; proposal?: FiscalProposal }
  | { kind: 'blocked'; current: FiscalYearRow }
  | { kind: 'propose'; proposal: FiscalProposal };

/** The same horizon as the accounting.fiscal_period check (FISCAL_PERIOD_HORIZON_DAYS). */
export const FISCAL_HORIZON_DAYS = 30;

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}
function iso(value: Date): string {
  return value.toISOString().slice(0, 10);
}
export function addDays(date: string, days: number): string {
  const value = utc(date);
  value.setUTCDate(value.getUTCDate() + days);
  return iso(value);
}
/** The last day of the 12-month year starting on `start` (a first of month). */
export function yearEnd(start: string): string {
  const value = utc(start);
  value.setUTCMonth(value.getUTCMonth() + 12);
  value.setUTCDate(value.getUTCDate() - 1);
  return iso(value);
}
function monthOf(date: string): number {
  return Number(date.slice(5, 7));
}
/** The Asia/Tokyo calendar date of an ISO time (the server's business date of GET /meta/setup-status). */
export function tokyoDate(isoTime: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(isoTime));
}

function overlapping(years: readonly FiscalYearRow[], start: string, end: string): FiscalYearRow | undefined {
  return years.find((year) => year.startDate <= end && year.endDate >= start);
}

function proposalFrom(
  start: string,
  years: readonly FiscalYearRow[],
  expectedStartMonth: number,
  continuation: boolean,
  previous: FiscalYearRow | undefined,
): FiscalProposal {
  const end = yearEnd(start);
  const proposal: FiscalProposal = {
    startDate: start,
    endDate: end,
    continuation,
    mismatch: monthOf(start) !== expectedStartMonth,
  };
  const overlap = overlapping(years, start, end);
  if (overlap) proposal.overlap = overlap;
  if (previous && addDays(previous.endDate, 1) < start)
    proposal.gap = { from: addDays(previous.endDate, 1), to: addDays(start, -1) };
  return proposal;
}

/**
 * AC-3: what the fiscal-year step shows. `endMonth` is company.profile's year-end month (12 when unset); `check` is the
 * accounting.fiscal_period status. (a) a year contains today and the check is not fail: show it, and propose the
 * continuation when the latest year ends within 30 days; (c) a year contains today but the check fails: propose
 * nothing; (b) no year contains today: continue the latest earlier year when that 12-month year contains today, else
 * the 12 months starting the month after the year-end month that contain today.
 */
export function proposeFiscalYear(input: {
  today: string;
  endMonth: number | undefined;
  years: readonly FiscalYearRow[];
  check: SetupCheckStatus | undefined;
}): FiscalPlan {
  const { today, years } = input;
  const expectedStartMonth = ((input.endMonth ?? 12) % 12) + 1;
  const sorted = [...years].sort((a, b) => a.endDate.localeCompare(b.endDate));
  const latest = sorted[sorted.length - 1];
  const current = years.find((year) => year.startDate <= today && year.endDate >= today);
  if (current) {
    if (input.check === 'fail') return { kind: 'blocked', current };
    const plan: FiscalPlan = { kind: 'current', current, mismatch: monthOf(current.startDate) !== expectedStartMonth };
    const next = latest ? addDays(latest.endDate, 1) : undefined;
    if (latest && next && latest.endDate < addDays(today, FISCAL_HORIZON_DAYS) && next.endsWith('-01'))
      plan.proposal = proposalFrom(next, years, expectedStartMonth, true, latest);
    return plan;
  }
  const previous = [...sorted].reverse().find((year) => year.endDate < today);
  if (previous) {
    const start = addDays(previous.endDate, 1);
    if (start.endsWith('-01') && yearEnd(start) >= today)
      return { kind: 'propose', proposal: proposalFrom(start, years, expectedStartMonth, true, previous) };
  }
  const month = String(expectedStartMonth).padStart(2, '0');
  let year = Number(today.slice(0, 4));
  if (`${year}-${month}-01` > today) year -= 1;
  return {
    kind: 'propose',
    proposal: proposalFrom(`${year}-${month}-01`, years, expectedStartMonth, false, previous),
  };
}

// ---- inventory (AC-4) ----

export type InventoryChoice = 'use' | 'none';

/** The two automatic settings as one choice; `mixed` when only one of them is on (neither choice preselected). */
export function inventoryState(autoIssue: boolean, autoReceipt: boolean): InventoryChoice | 'mixed' {
  if (autoIssue && autoReceipt) return 'use';
  if (!autoIssue && !autoReceipt) return 'none';
  return 'mixed';
}

/**
 * Guidance per choice (a rule of thumb from this project's industry templates, not law; docs/specs/setup-wizard.md
 * "データ・業務ルール").
 */
export const INVENTORY_GUIDE: Record<InventoryChoice, { title: Label; description: Label }> = {
  use: {
    title: { ja: '在庫を使う', en: 'Use stock' },
    description: {
      ja: '物品を仕入れて販売する会社の目安です（例: 小売・卸売・電器店・農家・飲食チェーンのテンプレート）。仕入請求書の確定で入庫し、売上請求書の確定で出庫します。',
      en: 'For companies that buy and sell goods (e.g. the retail, wholesale, appliance store, farm and restaurant chain templates). Purchase invoices receive stock and sales invoices issue it when submitted.',
    },
  },
  none: {
    title: { ja: '在庫を使わない', en: 'Do not use stock' },
    description: {
      ja: '物品を仕入れて売らず、役務・賃貸・工事などを請求する会社の目安です。請求書を確定しても在庫は動きません。',
      en: 'For companies that bill services, rent or work rather than buying and selling goods. Submitting invoices does not move stock.',
    },
  },
};

// ---- invoice issuer (AC-20) ----

const ISSUER_FROM_PROFILE: readonly (readonly [string, string])[] = [
  ['invoiceRegistrationNo', 'invoiceRegistrationNo'],
  ['postalCode', 'postalCode'],
  ['address', 'address'],
  ['phone', 'phone'],
  ['email', 'email'],
];

/** The sales.issuer draft from company.profile: legal name (else the company name) and the shared contact fields. */
export function issuerFromProfile(
  profile: Readonly<Record<string, unknown>> | null | undefined,
  companyName: string,
): Record<string, string> {
  const source = profile ?? {};
  const legal = typeof source.legalName === 'string' && source.legalName.trim() !== '' ? source.legalName : '';
  const issuer: Record<string, string> = { name: legal || companyName };
  for (const [from, to] of ISSUER_FROM_PROFILE) {
    const value = source[from];
    if (typeof value === 'string' && value !== '') issuer[to] = value;
  }
  return issuer;
}

/** company.profile's year-end month when it is a whole month 1-12. */
export function fiscalYearEndMonth(profile: unknown): number | undefined {
  if (typeof profile !== 'object' || profile === null) return undefined;
  const month = (profile as Record<string, unknown>).fiscalYearEndMonth;
  return typeof month === 'number' && Number.isInteger(month) && month >= 1 && month <= 12 ? month : undefined;
}
