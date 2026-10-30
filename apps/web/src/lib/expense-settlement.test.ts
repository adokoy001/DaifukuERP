// Unit tests of the /finance/expenses presentation (docs/specs/expense-settlement.md AC-20, D26).
import { describe, expect, it } from 'vitest';
import { draftSettlementInput } from '@daifuku/mod-expense/contract';
import { ApiError } from '../api/client.ts';
import {
  advanceBlock,
  cappedNote,
  clearAdvanceInput,
  draftedOnly,
  draftFailureKind,
  draftInput,
  groupBlock,
  groupKey,
  groupTitle,
  inputFor,
  isPayrollRefusal,
  parseCandidates,
  readyGroups,
  sameTarget,
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
  self: false,
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
  self: false,
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
  it('AC-3 AC-20 a group of more than 200 expenses drafts its oldest 200 and says how many wait for the next', () => {
    const ids = Array.from({ length: 201 }, (_, i) => id(1000 + i));
    const g = group({ count: 201, expenseIds: ids });
    const input = draftInput(g, []);
    expect(input.expenseIds).toEqual(ids.slice(0, 200));
    expect(draftSettlementInput.safeParse(input).success).toBe(true);
    expect(cappedNote(g)).toEqual({
      ja: '最初の 200 件で精算書を作成します（残り 1 件は次の精算書へ）',
      en: 'The settlement takes the oldest 200; the other 1 go into the next one',
    });
    expect(cappedNote(group({ expenseIds: ids.slice(0, 200) }))).toBeNull();
  });
  it('AC-15 AC-20 own groups and advances, and advance groups without an open advance, are not drafted here', () => {
    expect(groupBlock(group({}), [])).toBeNull();
    expect(groupBlock(group({ self: true }), [])?.en).toContain('settled by someone else');
    const adv = group({ paymentMethod: 'advance', kind: 'advance' });
    expect(groupBlock(adv, [])?.ja).toContain('未精算の仮払がない');
    expect(groupBlock(adv, [advance({ employeeId: id(2) })])?.ja).toContain('未精算の仮払がない');
    expect(groupBlock(adv, [advance({})])).toBeNull();
    expect(advanceBlock(advance({}))).toBeNull();
    expect(advanceBlock(advance({ self: true }))?.en).toContain('someone else');
  });
  it('AC-20 a retry rebuilds the request from the refreshed candidates, or offers none when the group is gone', () => {
    const g = group({ expenseIds: [id(100), id(101)] });
    const data = { groups: [g], advances: [advance({})], truncated: false };
    const target = { kind: 'group', key: groupKey(g) } as const;
    expect(inputFor(target, data)).toMatchObject({ expenseIds: [id(100), id(101)] });
    const refreshed = { ...data, groups: [{ ...g, count: 1, expenseIds: [id(101)] }] };
    expect(inputFor(target, refreshed)).toMatchObject({ expenseIds: [id(101)] });
    expect(inputFor(target, { ...data, groups: [] })).toBeNull();
    expect(inputFor(target, { ...data, groups: [{ ...g, self: true }] })).toBeNull();
    expect(inputFor({ kind: 'advance', id: id(50) }, data)).toEqual(clearAdvanceInput(advance({})));
    expect(inputFor({ kind: 'advance', id: id(51) }, data)).toBeNull();
    expect(sameTarget(target, { kind: 'group', key: groupKey(g) })).toBe(true);
    expect(sameTarget(target, { kind: 'advance', id: id(50) })).toBe(false);
    expect(sameTarget(undefined, target)).toBe(false);
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
  it('AC-15 AC-20 classifies a failed draft: self-settlement, a missing role (no retry), or worth a retry', () => {
    const denied = (op?: string) =>
      new ApiError(403, { code: 'PERMISSION_DENIED', message: 'denied', hint: '', details: op ? { op } : {} });
    expect(draftFailureKind(denied('create:self-settlement'))).toBe('self');
    expect(draftFailureKind(denied('create:requires-workforce_payroll'))).toBe('roles');
    expect(draftFailureKind(denied('create'))).toBe('roles');
    expect(draftFailureKind(denied())).toBe('roles');
    expect(draftFailureKind(new ApiError(409, { code: 'CONFLICT', message: 'held', hint: '' }))).toBe('other');
    expect(draftFailureKind(new ApiError(400, { code: 'VALIDATION', message: 'bad', hint: '' }))).toBe('other');
    expect(draftFailureKind(new Error('network'))).toBe('other');
  });
});
