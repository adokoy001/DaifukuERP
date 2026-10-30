// Pure presentation of /finance/expenses (docs/specs/expense-settlement.md AC-20): the candidate groups of
// expense.settlement_candidates (employee x payment method x site), their labels, sort order and summary, the refusal
// that names the missing role (D26), and the draft request of one group. No React, no fetch.
import {
  settlementCandidatesOutput,
  type CandidateGroup,
  type ExpenseSettlementKind,
  type OpenAdvance,
  type SettlementCandidates,
} from '@daifuku/mod-expense/contract';
import { isApiError } from '../api/client.ts';
import type { Label, Locale } from '../api/types.ts';

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

/** Labels of workforce_expense.paymentMethod as the employee chose it (shared with /me and /workforce). */
export const PAYMENT_METHOD_LABEL: Readonly<Record<CandidateGroup['paymentMethod'], Label>> = {
  personal: { ja: '立替', en: 'Paid personally' },
  corporate_card: { ja: '法人カード', en: 'Corporate card' },
  advance: { ja: '仮払金から支払', en: 'Paid from an advance' },
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

/**
 * The expense.draft_settlement input of a group: its kind and exactly its expenses (one site). An advance group with
 * exactly one open advance of the employee names it; with several, the accountant picks on the settlement form.
 */
export function draftInput(group: CandidateGroup, advances: readonly OpenAdvance[]): Record<string, unknown> {
  const own = advancesOf(advances, group.employeeId);
  return {
    employeeId: group.employeeId,
    kind: group.kind,
    expenseIds: [...group.expenseIds],
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

export function groupTitle(group: CandidateGroup, locale: Locale): string {
  const code = group.employeeCode ? `${group.employeeCode} ` : '';
  return `${code}${group.employeeName} · ${PAYMENT_METHOD_LABEL[group.paymentMethod][locale]} · ${group.siteName}`;
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

/** AC-20 / D26: the server refused because workforce_payroll is missing (accounting alone cannot settle). */
export function isPayrollRefusal(error: unknown): boolean {
  if (!isApiError(error) || error.code !== 'PERMISSION_DENIED') return false;
  const details = error.details as { op?: unknown } | undefined;
  return details?.op === REQUIRES_PAYROLL_OP;
}

export const REQUIRED_ROLES_TEXT: Label = {
  ja: '経費精算には、経理（accounting）と給与・精算本部（workforce_payroll）の両方の役割が必要です。拠点・店舗に限定された所属では使えません。必要なら管理者に役割の追加を依頼してください。',
  en: 'Expense settlement needs both the accounting and the workforce_payroll roles, with company-wide access (not limited to sites or stores). Ask your administrator to add them if you need them.',
};

export const settlementHref = (id: string) => `/e/${SETTLEMENT_ENTITY}/${id}`;
