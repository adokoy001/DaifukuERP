import { Decimal, newId, repo, type ContextParams } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkforceExpense, WorkforceLeaveRequest, WorkforceLeaveUsage } from '../src/index.ts';
import { leaveBalance } from '../src/leave-balance.ts';
import { call, fixture, type Command, type Fixture } from './helpers.ts';
let f: Fixture, sequence = 0;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f?.db.close(); });
interface Worker { employeeId: string; params: Partial<ContextParams> }
async function worker(): Promise<Worker> {
  const name = `case${++sequence}`, person = await f.person(name, 'workforce_employee');
  const employee = await call(f.db, f.hr.params, 'register_employee', { userId: person.id, siteId: f.siteId, code: name, name, hiredOn: '2026-01-01' });
  return { employeeId: employee.id, params: person.params };
}
async function grant(w: Worker, days: string, validFrom = '2026-09-01', expiresOn = '2026-09-30') {
  return call(f.db, f.hr.params, 'grant_leave', { employeeId: w.employeeId, validFrom, expiresOn, days, eligibilityConfirmed: true, basis: '雇用・出勤条件確認済みの演習付与' });
}
const balance = (w: Worker, date = '2026-09-12') => f.db.run(w.params, async (ctx) => (await leaveBalance(ctx, w.employeeId, date)).toString());
const requestLeave = (w: Worker, leaveDate: string, portion = 'full', idempotencyKey = newId()) => call(f.db, w.params, 'request_leave', { leaveDate, portion, idempotencyKey, reason: '私用のため' });
const reviewLeave = (row: Command, halfDayAgreement = false) => call(f.db, f.manager.params, 'review_leave', { requestId: row.id, expectedVersion: row.version, decision: 'approve', halfDayAgreement, reason: '業務調整と本人の希望を確認' });
const withdraw = (w: Worker, row: Command) => call(f.db, w.params, 'cancel_leave', { requestId: row.id, expectedVersion: row.version, reason: '本人都合により取消' });
async function expense(w: Worker, overrides: Record<string, unknown> = {}) {
  const input = { expectedVersion: 0, idempotencyKey: newId(), expenseDate: '2026-09-10', category: '交通費', description: '訪問交通費（演習）', amount: '1000', evidence: '演習の領収書参照-001', ...overrides };
  return { input, row: await call(f.db, w.params, 'save_expense', input) };
}
async function approveExpense(w: Worker, row: Command) {
  const submitted = await call(f.db, w.params, 'submit_expense', { expenseId: row.id, expectedVersion: row.version });
  return call(f.db, f.manager.params, 'review_expense', { expenseId: row.id, expectedVersion: submitted.version, decision: 'approve', reason: '証憑と用務を確認' });
}
const expenseRow = (id: string) => f.db.run({}, (ctx) => repo(ctx, WorkforceExpense).get(id));

describe('paid leave: eligibility, expiry and serialized ledger usage', () => {
  it('requires explicit eligibility, positive full/half days and valid employment/expiry dates', async () => {
    const w = await worker();
    const input = { employeeId: w.employeeId, validFrom: '2026-09-01', expiresOn: '2026-09-30', days: '1', eligibilityConfirmed: true, basis: '確認' };
    for (const patch of [{ eligibilityConfirmed: false }, { days: '0' }, { days: '0.25' }, { expiresOn: '2026-08-31' }]) await expect(call(f.db, f.hr.params, 'grant_leave', { ...input, ...patch })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(grant(w, '1', '2025-12-01')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await balance(w)).toBe('0');
  });
  it('uses earliest expiry first, requires half-day agreement, and restores only the original grant on cancellation', async () => {
    const w = await worker(), first = await grant(w, '1', '2026-09-01', '2026-09-12');
    await grant(w, '1', '2026-09-01', '2026-10-31');
    const request = await requestLeave(w, '2026-09-12', 'morning');
    await expect(reviewLeave(request)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await balance(w)).toBe('2');
    const approved = await reviewLeave(request, true);
    const usages = await f.db.run(w.params, (ctx) => repo(ctx, WorkforceLeaveUsage).list({ where: { requestId: request.id } }));
    expect(usages.items).toHaveLength(1); expect(usages.items[0]?.grantId).toBe(first.id);
    expect(await balance(w)).toBe('1.5'); expect(await balance(w, '2026-09-13')).toBe('1');
    const cancelled = await withdraw(w, approved);
    expect(await balance(w)).toBe('2'); expect(await balance(w, '2026-09-13')).toBe('1');
    await expect(withdraw(w, cancelled)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const ledger = await f.db.run(w.params, (ctx) => repo(ctx, WorkforceLeaveUsage).list({ where: { requestId: request.id } }));
    expect(ledger.total).toBe(2); expect(Decimal.sum(ledger.items.map((row) => row.days)).toString()).toBe('0');
  });
  it('rejects grants not yet effective or expired on the requested use date', async () => {
    const w = await worker();
    await grant(w, '1', '2026-08-01', '2026-08-31'); await grant(w, '1', '2026-09-10', '2026-09-30');
    await expect(requestLeave(w, '2026-09-01')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await balance(w, '2026-09-09')).toBe('0'); expect(await balance(w, '2026-09-10')).toBe('1');
  });
  it('serializes two approvals against one remaining day and permits the loser after the winner cancels', async () => {
    const w = await worker(); await grant(w, '1');
    const requests = [await requestLeave(w, '2026-09-20'), await requestLeave(w, '2026-09-21')];
    const results = await Promise.allSettled(requests.map((row) => reviewLeave(row)));
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1); expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect(await balance(w)).toBe('0');
    const rows = await f.db.run(w.params, (ctx) => repo(ctx, WorkforceLeaveRequest).list({ where: { employeeId: w.employeeId } }));
    const winner = rows.items.find((row) => row.status === 'approved'), loser = rows.items.find((row) => row.status === 'pending');
    if (!winner || !loser) throw new Error('Concurrent approval fixture is incomplete');
    await withdraw(w, winner); expect(await balance(w)).toBe('1');
    await reviewLeave(loser); expect(await balance(w)).toBe('0');
  });
  it('replays one request, rejects changed input / overlapping portions, and cancellation does not resurrect a replayed request', async () => {
    const w = await worker(); await grant(w, '2'); const key = newId();
    const pair = await Promise.all([requestLeave(w, '2026-09-22', 'morning', key), requestLeave(w, '2026-09-22', 'morning', key)]);
    expect(pair[0]?.id).toBe(pair[1]?.id); const first = pair[0]; if (!first) throw new Error('Missing request');
    await expect(requestLeave(w, '2026-09-23', 'morning', key)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(requestLeave(w, '2026-09-22', 'morning')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const cancelled = await withdraw(w, first);
    expect(await requestLeave(w, '2026-09-22', 'morning', key)).toMatchObject({ id: first.id, status: 'cancelled', version: cancelled.version });
    expect(await balance(w)).toBe('2');
    expect((await f.db.run(w.params, (ctx) => repo(ctx, WorkforceLeaveUsage).list({ where: { requestId: first.id } }))).total).toBe(0);
  });
  it('rejects out-of-site and self approval, and a rejected request consumes no leave', async () => {
    const employee = await call(f.db, f.hr.params, 'register_employee', { userId: f.manager.id, siteId: f.siteId, code: 'MGR', name: 'Manager', hiredOn: '2026-01-01' });
    const w = { employeeId: employee.id, params: f.manager.params }; await grant(w, '1');
    const request = await requestLeave(w, '2026-09-24');
    await expect(reviewLeave(request)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(call(f.db, f.remote.params, 'review_leave', { requestId: request.id, expectedVersion: request.version, decision: 'approve', reason: '別拠点', halfDayAgreement: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await call(f.db, f.hr.params, 'review_leave', { requestId: request.id, expectedVersion: request.version, decision: 'reject', reason: '申請を再確認', halfDayAgreement: false });
    expect(await balance(w)).toBe('1');
  });
});

describe('employee expenses: idempotency, freeze and settlement', () => {
  it('replays initial save exactly and rejects changed duplicate input, fractional yen and future expense dates', async () => {
    const w = await worker(), saved = await expense(w);
    expect(await call(f.db, w.params, 'save_expense', saved.input)).toMatchObject({ id: saved.row.id, version: saved.row.version });
    await expect(call(f.db, w.params, 'save_expense', { ...saved.input, amount: '2000' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(expense(w, { amount: '0.5' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(expense(w, { expenseDate: '2026-09-13' })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await expenseRow(saved.row.id)).amount.toString()).toBe('1000');
  });
  it('freezes submitted amounts, permits returned corrections, and settles once under concurrency', async () => {
    const w = await worker(), saved = await expense(w);
    const submitted = await call(f.db, w.params, 'submit_expense', { expenseId: saved.row.id, expectedVersion: saved.row.version });
    await expect(call(f.db, w.params, 'save_expense', { ...saved.input, expenseId: saved.row.id, expectedVersion: submitted.version, amount: '1200' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const returned = await call(f.db, f.manager.params, 'review_expense', { expenseId: saved.row.id, expectedVersion: submitted.version, decision: 'return', reason: '経路と金額を再確認' });
    const corrected = await call(f.db, w.params, 'save_expense', { ...saved.input, expenseId: saved.row.id, expectedVersion: returned.version, amount: '1200' });
    const approved = await approveExpense(w, corrected);
    await expect(call(f.db, w.params, 'cancel_expense', { expenseId: approved.id, expectedVersion: approved.version, reason: '取下げ' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const input = { expenseId: approved.id, expectedVersion: approved.version, paidOn: '2026-09-12', reference: '経理精算-001' };
    const result = await Promise.allSettled([call(f.db, f.payroll.params, 'settle_expense', input), call(f.db, f.payroll.params, 'settle_expense', input)]);
    expect(result.filter((row) => row.status === 'fulfilled')).toHaveLength(1); expect(result.filter((row) => row.status === 'rejected')).toHaveLength(1);
    const final = await expenseRow(approved.id);
    expect(final).toMatchObject({ status: 'settled', paidOn: '2026-09-12', paymentReference: '経理精算-001', settledBy: f.payroll.id }); expect(final.amount.toString()).toBe('1200');
    await expect(call(f.db, f.payroll.params, 'settle_expense', { ...input, expectedVersion: final.version })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
  it('requires headquarters and a real settlement date; cancelled submissions cannot be approved', async () => {
    const w = await worker(), saved = await expense(w), approved = await approveExpense(w, saved.row);
    const input = { expenseId: approved.id, expectedVersion: approved.version, paidOn: '2026-09-12', reference: '精算記録' };
    await expect(call(f.db, f.manager.params, 'settle_expense', input)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    for (const paidOn of ['2026-09-09', '2026-09-13']) await expect(call(f.db, f.payroll.params, 'settle_expense', { ...input, paidOn })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await expenseRow(approved.id)).status).toBe('approved');
    const next = await expense(w), submitted = await call(f.db, w.params, 'submit_expense', { expenseId: next.row.id, expectedVersion: next.row.version });
    const cancelled = await call(f.db, w.params, 'cancel_expense', { expenseId: submitted.id, expectedVersion: submitted.version, reason: '重複申請を取消' });
    await expect(call(f.db, f.manager.params, 'review_expense', { expenseId: cancelled.id, expectedVersion: cancelled.version, decision: 'approve', reason: '確認' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
