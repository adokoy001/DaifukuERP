// Unit tests of the /finance/expenses presentation (docs/specs/expense-settlement.md AC-20, D26).
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client.ts';
import {
  clearAdvanceInput,
  draftedOnly,
  draftInput,
  groupTitle,
  isPayrollRefusal,
  parseCandidates,
  readyGroups,
  summaryText,
  type CandidateGroup,
  type OpenAdvance,
} from './expense-settlement.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const group = (over: Partial<CandidateGroup>): CandidateGroup => ({
  employeeId: id(1),
  employeeCode: 'E1',
  employeeName: '山田',
  siteId: id(9),
  siteName: '東拠点',
  paymentMethod: 'personal',
  kind: 'reimbursement',
  count: 1,
  total: '1100',
  oldestDate: '2026-10-05',
  expenseIds: [id(100)],
  inDraftCount: 0,
  ...over,
});
const advance = (over: Partial<OpenAdvance>): OpenAdvance => ({
  id: id(50),
  number: 'ADV-2026-000001',
  employeeId: id(1),
  employeeName: '山田',
  siteId: id(9),
  date: '2026-10-01',
  amount: '10000',
  purpose: '出張',
  ...over,
});

describe('expense settlement candidates (AC-20)', () => {
  it('AC-20 sorts ready groups by the oldest expense and keeps drafted-only groups apart', () => {
    const groups = [
      group({ employeeCode: 'E2', oldestDate: '2026-10-07' }),
      group({ employeeCode: 'E1', oldestDate: '2026-10-02', paymentMethod: 'corporate_card', kind: 'corporate_card' }),
      group({ employeeCode: 'E3', count: 0, expenseIds: [], oldestDate: null, inDraftCount: 2 }),
    ];
    expect(readyGroups(groups).map((g) => g.employeeCode)).toEqual(['E1', 'E2']);
    expect(draftedOnly(groups).map((g) => g.employeeCode)).toEqual(['E3']);
  });
  it('AC-20 the draft request carries the group kind and exactly its expenses; one open advance is named', () => {
    const g = group({ expenseIds: [id(100), id(101)] });
    expect(draftInput(g, [])).toEqual({ employeeId: id(1), kind: 'reimbursement', expenseIds: [id(100), id(101)] });
    const adv = group({ paymentMethod: 'advance', kind: 'advance' });
    expect(draftInput(adv, [advance({})])).toMatchObject({ kind: 'advance', advanceId: id(50) });
    expect(draftInput(adv, [advance({}), advance({ id: id(51) })])).not.toHaveProperty('advanceId');
    expect(draftInput(adv, [advance({ employeeId: id(2) })])).not.toHaveProperty('advanceId');
  });
  it('AC-20 D24 an open advance is cleared by an advance settlement naming it (no expense list)', () => {
    expect(clearAdvanceInput(advance({}))).toEqual({ employeeId: id(1), kind: 'advance', advanceId: id(50) });
  });
  it('AC-20 titles and summaries in Japanese and English', () => {
    const g = group({ paymentMethod: 'corporate_card', kind: 'corporate_card' });
    expect(groupTitle(g, 'ja')).toBe('E1 山田 · 法人カード · 東拠点');
    expect(groupTitle(g, 'en')).toBe('E1 山田 · Corporate card · 東拠点');
    const data = { groups: [g, group({ count: 2 })], advances: [advance({})], truncated: false };
    expect(summaryText(data)).toEqual({
      ja: '精算待ち 2 グループ（経費 3 件）、未精算の仮払 1 件',
      en: '2 group(s) awaiting settlement (3 expense(s)), 1 open advance(s)',
    });
    expect(summaryText({ groups: [], advances: [], truncated: false }).en).toContain('No expense');
  });
  it('AC-20 parses the action output strictly (a malformed answer is an error, not a wrong number)', () => {
    const ok = { groups: [group({})], advances: [advance({})], truncated: false };
    expect(parseCandidates(ok)).toEqual(ok);
    expect(() => parseCandidates({ groups: [{ ...group({}), count: 'x' }], advances: [], truncated: false })).toThrow();
  });
  it('AC-20 D26 recognizes the missing workforce_payroll refusal by details.op only', () => {
    const refusal = new ApiError(403, {
      code: 'PERMISSION_DENIED',
      message: 'denied',
      hint: '',
      details: { entity: 'expense_settlement', op: 'candidates:requires-workforce_payroll', roles: ['accounting'] },
    });
    expect(isPayrollRefusal(refusal)).toBe(true);
    const other = new ApiError(403, {
      code: 'PERMISSION_DENIED',
      message: 'denied',
      hint: '',
      details: { op: 'create' },
    });
    expect(isPayrollRefusal(other)).toBe(false);
    expect(isPayrollRefusal(new Error('x'))).toBe(false);
  });
});
