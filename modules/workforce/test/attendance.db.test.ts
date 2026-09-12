import { newId, PermissionDenied, repo, runAction, StateError, ValidationError } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkforceAttendance, WorkforceAttendanceCorrection, WorkforceEmployee, WorkforcePunch } from '../src/index.ts';
import { call, fixture, type Fixture } from './helpers.ts';
let f: Fixture;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f?.db.close(); });
async function punch(kind: string, version: number, time: string, key = newId()) { return call(f.db, f.alice.params, 'punch', { kind, expectedVersion: version, idempotencyKey: key }, time); }
describe('workforce attendance invariants', () => {
  it('serializes double clock-in, preserves seconds, and rejects generic ownership bypass', async () => {
    const input = { kind: 'clock_in', expectedVersion: 0, idempotencyKey: newId() };
    const results = await Promise.all([call(f.db, f.alice.params, 'punch', input, '2026-08-03T09:00:00.123+09:00'), call(f.db, f.alice.params, 'punch', input, '2026-08-03T09:00:00.123+09:00')]);
    expect(results[0]).toEqual(results[1]);
    expect(await f.db.run({}, (ctx) => repo(ctx, WorkforcePunch).count())).toBe(1);
    const row = results[0] as { id: string; version: number };
    await expect(f.db.run(f.alice.params, (ctx) => repo(ctx, WorkforceAttendance).update(row.id, { workedMs: 0 }))).rejects.toBeInstanceOf(PermissionDenied);
    const out = await punch('clock_out', row.version, '2026-08-03T10:00:00.456+09:00');
    const stored = await f.db.run(f.alice.params, (ctx) => repo(ctx, WorkforceAttendance).get(out.id));
    expect(stored.workedMs).toBe(3600333);
    await expect(punch('clock_out', row.version, '2026-08-03T10:01:00+09:00')).rejects.toBeInstanceOf(StateError);
    await expect(call(f.db, f.alice.params, 'punch', { ...input, expectedVersion: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('applies employee and site filters to reads, counts, aggregates and portals', async () => {
    for (const person of [f.bob, f.remote]) {
      expect(await f.db.run(person.params, (ctx) => repo(ctx, WorkforceAttendance).count())).toBe(0);
      expect((await f.db.run(person.params, (ctx) => repo(ctx, WorkforceAttendance).list())).items).toEqual([]);
      const portal = await f.db.run(person.params, (ctx) => runAction(ctx, person === f.bob ? 'workforce.my_portal' : 'workforce.management_portal', { period: '2026-08' })) as { attendances: unknown[]; users?: unknown[] };
      expect(portal.attendances).toEqual([]);
      if (portal.users) expect(portal.users).toEqual([]);
    }
    expect(await f.db.run(f.manager.params, (ctx) => repo(ctx, WorkforceAttendance).count())).toBe(1);
  });
  it('records clock-out despite insufficient breaks, then requires reviewed correction', async () => {
    const row = await punch('clock_in', 0, '2026-08-04T09:00:00+09:00');
    const closed = await punch('clock_out', row.version, '2026-08-04T18:00:00+09:00');
    const submitted = await call(f.db, f.alice.params, 'submit_attendance', { attendanceId: row.id, expectedVersion: closed.version });
    const review = { attendanceId: row.id, expectedVersion: submitted.version, decision: 'approve', dayKind: 'workday', reason: '確認' };
    await expect(call(f.db, f.manager.params, 'review_attendance', review)).rejects.toBeInstanceOf(ValidationError);
    const correction = await call(f.db, f.alice.params, 'request_correction', { attendanceId: row.id, expectedVersion: submitted.version, idempotencyKey: newId(), clockIn: '2026-08-04T09:00:00+09:00', clockOut: '2026-08-04T18:00:00+09:00', breaks: [{ start: '2026-08-04T12:00:00+09:00', end: '2026-08-04T13:00:00+09:00' }], reason: '休憩打刻漏れ' });
    await expect(call(f.db, { ...f.alice.params, roles: ['workforce_manager'] }, 'review_correction', { correctionId: correction.id, expectedVersion: correction.version, decision: 'approve', reason: '自分で' })).rejects.toBeInstanceOf(PermissionDenied);
    await call(f.db, f.manager.params, 'review_correction', { correctionId: correction.id, expectedVersion: correction.version, decision: 'approve', reason: '本人と確認' });
    const fixed = await f.db.run(f.alice.params, (ctx) => repo(ctx, WorkforceAttendance).get(row.id));
    expect(fixed).toMatchObject({ workedMs: 28800000, status: 'closed' });
  });
  it('recovers a forgotten clock-out after 24 hours without deleting the original punch', async () => {
    const row = await punch('clock_in', 0, '2026-08-05T09:00:00+09:00');
    await expect(punch('clock_out', row.version, '2026-08-06T11:00:00+09:00')).rejects.toBeInstanceOf(ValidationError);
    const correction = await call(f.db, f.alice.params, 'request_correction', { attendanceId: row.id, expectedVersion: row.version, idempotencyKey: newId(), clockIn: '2026-08-05T09:00:00+09:00', clockOut: '2026-08-05T10:00:00+09:00', breaks: [], reason: '退勤忘れ' });
    await call(f.db, f.manager.params, 'review_correction', { correctionId: correction.id, expectedVersion: correction.version, decision: 'approve', reason: '勤務実績確認' });
    expect(await f.db.run(f.alice.params, (ctx) => repo(ctx, WorkforcePunch).count({ attendanceId: row.id }))).toBe(1);
    const next = await punch('clock_in', 0, '2026-08-06T09:00:00+09:00');
    await punch('clock_out', next.version, '2026-08-06T10:00:00+09:00');
  });
  it('rejects correction overlap with the next shift and protects employee transfer while unfinished', async () => {
    const a = await punch('clock_in', 0, '2026-08-07T22:00:00+09:00');
    await punch('clock_out', a.version, '2026-08-08T03:00:00+09:00');
    const b = await punch('clock_in', 0, '2026-08-08T04:00:00+09:00');
    await punch('clock_out', b.version, '2026-08-08T05:00:00+09:00');
    const row = await f.db.run({}, (ctx) => repo(ctx, WorkforceAttendance).get(a.id));
    const correction = await call(f.db, f.alice.params, 'request_correction', { attendanceId: row.id, expectedVersion: row.version, idempotencyKey: newId(), clockIn: '2026-08-07T22:00:00+09:00', clockOut: '2026-08-08T04:30:00+09:00', breaks: [{ start: '2026-08-08T01:00:00+09:00', end: '2026-08-08T02:00:00+09:00' }], reason: '訂正' });
    await expect(call(f.db, f.manager.params, 'review_correction', { correctionId: correction.id, expectedVersion: correction.version, decision: 'approve', reason: '確認' })).rejects.toBeInstanceOf(StateError);
    expect((await f.db.run({}, (ctx) => repo(ctx, WorkforceAttendanceCorrection).get(correction.id))).status).toBe('pending');
    await expect(f.db.run(f.hr.params, (ctx) => repo(ctx, WorkforceEmployee).update(f.employee.id, { siteId: f.otherSiteId }))).rejects.toBeInstanceOf(StateError);
  });
});
