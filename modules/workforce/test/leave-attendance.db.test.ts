import { newId, repo, type ContextParams } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkforceAttendance, WorkforceAttendanceCorrection, WorkforceLeaveRequest, WorkforceLeaveUsage } from '../src/index.ts';
import { call, fixture, type Command, type Fixture } from './helpers.ts';

let f: Fixture, sequence = 0;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f?.db.close(); });
interface Worker { id: string; params: Partial<ContextParams> }
async function worker(): Promise<Worker> {
  const name = `calendar${++sequence}`, person = await f.person(name, 'workforce_employee');
  const employee = await call(f.db, f.hr.params, 'register_employee', { userId: person.id, siteId: f.siteId, code: name, name, hiredOn: '2026-01-01' });
  await call(f.db, f.hr.params, 'grant_leave', { employeeId: employee.id, validFrom: '2026-09-01', expiresOn: '2026-09-30', days: '2', eligibilityConfirmed: true, basis: '確認済みの演習付与' });
  return { id: employee.id, params: person.params };
}
const punch = (w: Worker, kind: string, version: number, time: string) => call(f.db, w.params, 'punch', { kind, expectedVersion: version, idempotencyKey: newId() }, time);
async function shift(w: Worker, end = '2026-09-11T02:00:00+09:00'): Promise<Command> {
  const started = await punch(w, 'clock_in', 0, '2026-09-10T22:00:00+09:00');
  return punch(w, 'clock_out', started.version, end);
}
const request = (w: Worker, portion = 'full') => call(f.db, w.params, 'request_leave', { leaveDate: '2026-09-11', portion, idempotencyKey: newId(), reason: '私用' });
const approveLeave = (row: Command) => call(f.db, f.manager.params, 'review_leave', { requestId: row.id, expectedVersion: row.version, decision: 'approve', halfDayAgreement: true, reason: '本人の希望と勤務確認' });
async function submit(w: Worker, row: Command): Promise<Command> {
  return call(f.db, w.params, 'submit_attendance', { attendanceId: row.id, expectedVersion: row.version });
}
const approveAttendance = (row: Command) => call(f.db, f.manager.params, 'review_attendance', { attendanceId: row.id, expectedVersion: row.version, decision: 'approve', dayKind: 'workday', reason: '勤務確認' });
const usageCount = (w: Worker) => f.db.run(w.params, (ctx) => repo(ctx, WorkforceLeaveUsage).count({ employeeId: w.id }));

describe('full-day leave and actual work on every JST calendar date', () => {
  it.each(['full', 'two halves'])('rejects %s approval after a shift crosses into the leave date without consuming balance', async (kind) => {
    const w = await worker(); await shift(w);
    if (kind === 'two halves') await approveLeave(await request(w, 'morning'));
    const row = await request(w, kind === 'full' ? 'full' : 'afternoon'), before = await usageCount(w);
    await expect(approveLeave(row)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await usageCount(w)).toBe(before);
    expect((await f.db.run(w.params, (ctx) => repo(ctx, WorkforceLeaveRequest).get(row.id))).status).toBe('pending');
  });
  it('rejects shift approval when full-day leave on the following date was approved first', async () => {
    const w = await worker(); await approveLeave(await request(w));
    const row = await submit(w, await shift(w));
    await expect(approveAttendance(row)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect((await f.db.run(w.params, (ctx) => repo(ctx, WorkforceAttendance).get(row.id))).status).toBe('submitted');
    expect(await usageCount(w)).toBe(1);
  });
  it('rejects an approved-shift correction extending into full-day leave and preserves both records', async () => {
    const w = await worker(), row = await approveAttendance(await submit(w, await shift(w, '2026-09-10T23:00:00+09:00')));
    await approveLeave(await request(w));
    const correction = await call(f.db, w.params, 'request_correction', { attendanceId: row.id, expectedVersion: row.version, idempotencyKey: newId(), clockIn: '2026-09-10T22:00:00+09:00', clockOut: '2026-09-11T02:00:00+09:00', breaks: [], reason: '退勤時刻の訂正' });
    await expect(call(f.db, f.manager.params, 'review_correction', { correctionId: correction.id, expectedVersion: correction.version, decision: 'approve', reason: '確認' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect((await f.db.run(w.params, (ctx) => repo(ctx, WorkforceAttendanceCorrection).get(correction.id))).status).toBe('pending');
    const unchanged = await f.db.run(w.params, (ctx) => repo(ctx, WorkforceAttendance).get(row.id));
    expect(unchanged.version).toBe(row.version); expect(unchanged.clockOut?.toISOString()).toBe('2026-09-10T14:00:00.000Z');
    expect(await usageCount(w)).toBe(1);
  });
  it.each(['leave first', 'attendance first'])('allows a shift ending exactly at midnight: %s', async (order) => {
    const w = await worker();
    if (order === 'leave first') await approveLeave(await request(w));
    expect((await approveAttendance(await submit(w, await shift(w, '2026-09-11T00:00:00+09:00')))).status).toBe('approved');
    if (order === 'attendance first') await approveLeave(await request(w));
    expect(await usageCount(w)).toBe(1);
  });
  it.each(['leave first', 'attendance first'])('excludes a recorded break covering the next-date segment: %s', async (order) => {
    const w = await worker();
    if (order === 'leave first') await approveLeave(await request(w));
    const started = await punch(w, 'clock_in', 0, '2026-09-10T22:00:00+09:00');
    const correction = await call(f.db, w.params, 'request_correction', { attendanceId: started.id, expectedVersion: started.version, idempotencyKey: newId(), clockIn: '2026-09-10T22:00:00+09:00', clockOut: '2026-09-11T02:00:00+09:00', breaks: [{ start: '2026-09-11T00:00:00+09:00', end: '2026-09-11T02:00:00+09:00' }], reason: '実際の勤務・休憩確認' });
    await call(f.db, f.manager.params, 'review_correction', { correctionId: correction.id, expectedVersion: correction.version, decision: 'approve', reason: '確認' });
    const closed = await f.db.run(w.params, (ctx) => repo(ctx, WorkforceAttendance).get(started.id));
    expect((await approveAttendance(await submit(w, closed))).status).toBe('approved');
    if (order === 'attendance first') await approveLeave(await request(w));
  });
  it('excludes an ongoing break and does not project an open shift into future leave', async () => {
    const w = await worker(), started = await punch(w, 'clock_in', 0, '2026-09-10T22:00:00+09:00');
    const row = await request(w);
    await call(f.db, f.manager.params, 'review_leave', { requestId: row.id, expectedVersion: row.version, decision: 'approve', halfDayAgreement: false, reason: '翌日の休暇確認' }, '2026-09-10T23:00:00+09:00');
    const second = await worker(), opened = await punch(second, 'clock_in', 0, '2026-09-10T22:00:00+09:00');
    await punch(second, 'break_start', opened.version, '2026-09-10T23:00:00+09:00');
    expect((await approveLeave(await request(second))).status).toBe('approved');
    expect(started.status).toBe('working');
  });
  it('blocks leave approval for actual elapsed work in an unclosed previous-date shift', async () => {
    const w = await worker(); await punch(w, 'clock_in', 0, '2026-09-10T22:00:00+09:00');
    await expect(approveLeave(await request(w))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await usageCount(w)).toBe(0);
  });
});
