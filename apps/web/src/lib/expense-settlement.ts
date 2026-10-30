// Pure presentation of /finance/expenses (docs/specs/expense-settlement.md AC-20): the candidate groups of
// expense.settlement_candidates (employee x payment method x site), their labels, sort order and summary, which group
// can be drafted here (not the caller's own, not an advance group without an open advance), the refusals that name the
// missing role or the self-settlement rule (D26, AC-15), and the draft request of one group. No React, no fetch.
import {
  MAX_DRAFT_EXPENSES,
  SELF_SETTLEMENT_SUFFIX,
  settlementCandidatesOutput,
  type CandidateGroup,
  type ExpenseSettlementKind,
  type OpenAdvance,
  type SettlementCandidates,
} from '@daifuku/mod-expense/contract';
import { isApiError } from '../api/client.ts';
import type { Label, Locale } from '../api/types.ts';
import { expensePaymentMethods } from './workforce.ts';

export const CANDIDATES_ACTION = 'expense.settlement_candidates';
export const DRAFT_ACTION = 'expense.draft_settlement';
export const SETTLEMENT_ENTITY = 'expense_settlement';
export const ADVANCE_ENTITY = 'expense_advance';
export const REQUIRES_PAYROLL_OP = 'candidates:requires-workforce_payroll';

export type { CandidateGroup, OpenAdvance, SettlementCandidates };

export const KIND_LABEL: Readonly<Record<ExpenseSettlementKind, Label>> = {
  reimbursement: { ja: '立替精算', en: 'Reimbursement' },
  corporate_card: { ja: '法人カード精算', en: 'Corporate card' },
  advance: { ja: '仮払精算', en: 'Advance clearing' },
};

/** Strict parse of the action output (a malformed answer fails the read instead of drawing wrong numbers). */
export function parseCandidates(raw: unknown): SettlementCandidates {
  return settlementCandidatesOutput.parse(raw);
}

/** Oldest waiting expense first, then employee code, method and site, so the same input always draws the same list. */
export function sortGroups(groups: readonly CandidateGroup[]): CandidateGroup[] {
  return [...groups].sort(
    (a, b) =>
      (a.oldestDate ?? '9999-12-31').localeCompare(b.oldestDate ?? '9999-12-31') ||
      a.employeeCode.localeCompare(b.employeeCode) ||
      a.paymentMethod.localeCompare(b.paymentMethod) ||
      a.siteName.localeCompare(b.siteName),
  );
}

/** Groups with at least one expense that can go into a new settlement (the others only have drafted expenses). */
export function readyGroups(groups: readonly CandidateGroup[]): CandidateGroup[] {
  return sortGroups(groups.filter((g) => g.count > 0));
}

/** Groups whose every approved expense already sits in a draft settlement. */
export function draftedOnly(groups: readonly CandidateGroup[]): CandidateGroup[] {
  return sortGroups(groups.filter((g) => g.count === 0 && g.inDraftCount > 0));
}

/** The open advances of one employee (the group's advance settlement clears one of them). */
export function advancesOf(advances: readonly OpenAdvance[], employeeId: string): OpenAdvance[] {
  return advances.filter((a) => a.employeeId === employeeId);
}

/** The key of a group (one employee, payment method and site). */
export const groupKey = (group: CandidateGroup): string => `${group.employeeId}|${group.paymentMethod}|${group.siteId}`;

/**
 * The expense.draft_settlement input of a group: its kind and its expenses (one site), at most the
 * MAX_DRAFT_EXPENSES oldest (candidates lists them oldest first; the rest go into the next settlement). An advance
 * group with exactly one open advance of the employee names it; with several, the accountant picks on the form.
 */
export function draftInput(group: CandidateGroup, advances: readonly OpenAdvance[]): Record<string, unknown> {
  const own = advancesOf(advances, group.employeeId);
  return {
    employeeId: group.employeeId,
    kind: group.kind,
    expenseIds: group.expenseIds.slice(0, MAX_DRAFT_EXPENSES),
    ...(group.kind === 'advance' && own.length === 1 && own[0] ? { advanceId: own[0].id } : {}),
  };
}

/**
 * The draft of an advance settlement for one open advance (D24): the employee's approved "paid from an advance"
 * expenses outside another settlement, or no lines at all for an unused advance (a full refund on submit).
 */
export function clearAdvanceInput(advance: OpenAdvance): Record<string, unknown> {
  return { employeeId: advance.employeeId, kind: 'advance', advanceId: advance.id };
}

/** A note when the group holds more expenses than one draft takes (AC-3: at most MAX_DRAFT_EXPENSES). */
export function cappedNote(group: CandidateGroup): Label | null {
  const rest = group.expenseIds.length - MAX_DRAFT_EXPENSES;
  if (rest <= 0) return null;
  return {
    ja: `最初の ${MAX_DRAFT_EXPENSES} 件で精算書を作成します（残り ${rest} 件は次の精算書へ）`,
    en: `The settlement takes the oldest ${MAX_DRAFT_EXPENSES}; the other ${rest} go into the next one`,
  };
}

/**
 * Why a group cannot be drafted from this screen, or null when it can: the caller's own expenses (AC-15: someone else
 * settles them), or an advance group whose employee has no open advance (an advance settlement needs one to submit).
 */
export function groupBlock(group: CandidateGroup, advances: readonly OpenAdvance[]): Label | null {
  if (group.self)
    return { ja: '自分の経費は別の担当者が精算します', en: 'Your own expenses are settled by someone else' };
  if (group.kind === 'advance' && advancesOf(advances, group.employeeId).length === 0)
    return {
      ja: '未精算の仮払がないため作成できません。先に「仮払の一覧」で仮払を記録して確定してください（手順はマニュアル）',
      en: 'No open advance to clear: record and submit the advance first (All advances; see the manual)',
    };
  return null;
}

/** Why an open advance cannot be cleared from this screen (the caller's own advance), or null. */
export function advanceBlock(advance: OpenAdvance): Label | null {
  return advance.self
    ? { ja: '自分の仮払は別の担当者が精算します', en: 'Your own advance is cleared by someone else' }
    : null;
}

/** What a draft request is for, so a retry can rebuild it from the refreshed candidates. */
export type DraftTarget = { kind: 'group'; key: string } | { kind: 'advance'; id: string };

/** The input of `target` in the current candidates, or null when it is gone or blocked (nothing left to retry). */
export function inputFor(target: DraftTarget, data: SettlementCandidates): Record<string, unknown> | null {
  if (target.kind === 'group') {
    const group = readyGroups(data.groups).find((g) => groupKey(g) === target.key);
    return group && !groupBlock(group, data.advances) ? draftInput(group, data.advances) : null;
  }
  const advance = data.advances.find((a) => a.id === target.id);
  return advance && !advanceBlock(advance) ? clearAdvanceInput(advance) : null;
}

export function sameTarget(a: DraftTarget | undefined, b: DraftTarget): boolean {
  if (!a) return false;
  if (a.kind === 'group') return b.kind === 'group' && a.key === b.key;
  return b.kind === 'advance' && a.id === b.id;
}

export function groupTitle(group: CandidateGroup, locale: Locale): string {
  const code = group.employeeCode ? `${group.employeeCode} ` : '';
  return `${code}${group.employeeName} · ${expensePaymentMethods[group.paymentMethod][locale]} · ${group.siteName}`;
}

export function summaryText(data: SettlementCandidates): Label {
  const ready = readyGroups(data.groups);
  const expenses = ready.reduce((n, g) => n + g.count, 0);
  if (ready.length === 0 && data.advances.length === 0)
    return {
      ja: '精算待ちの経費と未精算の仮払はありません。',
      en: 'No expense awaits settlement and no advance is open.',
    };
  return {
    ja: `精算待ち ${ready.length} グループ（経費 ${expenses} 件）、未精算の仮払 ${data.advances.length} 件`,
    en: `${ready.length} group(s) awaiting settlement (${expenses} expense(s)), ${data.advances.length} open advance(s)`,
  };
}

/** `details.op` of a PERMISSION_DENIED answer, or null for anything else. */
function deniedOp(error: unknown): string | null {
  if (!isApiError(error) || error.code !== 'PERMISSION_DENIED') return null;
  const op = (error.details as { op?: unknown } | undefined)?.op;
  return typeof op === 'string' ? op : '';
}

/** AC-20 / D26: the server refused because workforce_payroll is missing (accounting alone cannot settle). */
export function isPayrollRefusal(error: unknown): boolean {
  return deniedOp(error) === REQUIRES_PAYROLL_OP;
}

/**
 * The kind of a failed draft request: `self` (AC-15, `<op>:self-settlement`), `roles` (any other refusal: the
 * `<op>:requires-workforce_payroll` suffix, the kernel's plain op, a bare 403), or `other` (validation, conflict,
 * network: worth a retry). Only `other` offers a retry; a permission refusal answers the same every time.
 */
export function draftFailureKind(error: unknown): 'self' | 'roles' | 'other' {
  const op = deniedOp(error);
  if (op?.endsWith(SELF_SETTLEMENT_SUFFIX)) return 'self';
  if (op !== null || (isApiError(error) && error.status === 403)) return 'roles';
  return 'other';
}

export const REQUIRED_ROLES_TEXT: Label = {
  ja: '経費精算には、経理（accounting）と給与・精算本部（workforce_payroll）の両方の役割が必要です。拠点・店舗に限定された所属では使えません。必要なら管理者に役割の追加を依頼してください。',
  en: 'Expense settlement needs both the accounting and the workforce_payroll roles, with company-wide access (not limited to sites or stores). Ask your administrator to add them if you need them.',
};

export const SELF_SETTLEMENT_TEXT: Label = {
  ja: '自分の経費・仮払の精算書は作成・変更・確定できません。別の経理担当者に依頼してください。',
  en: 'You cannot create, change or submit the settlement of your own expenses or advance. Ask another accountant.',
};
