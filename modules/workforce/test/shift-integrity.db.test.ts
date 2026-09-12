import { bootstrapTenant, companies, companyMemberships, newId, repo, runAction } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkforceEmployee, WorkforcePayPolicy, WorkforceShiftAssignment, WorkforceShiftPlan, WorkforceShiftProfile, WorkforceSite } from '../src/index.ts';
import { addDays } from '../src/services/time.ts';
import { at, call, fixture, NOW, type Fixture } from './helpers.ts';
import { assignment, availability, board, conditions, defined, draft, mine, profile, publish, ready, slot } from './shift-helpers.ts';
let f: Fixture;
beforeAll(async () => { f = await fixture(); await conditions(f); });
afterAll(async () => { await f?.db.close(); });
async function save(weekStart: string, sourceRevision: string, slots = [slot(weekStart)], assignments = [assignment(f.employee.id)]) {
  return call(f.db, f.manager.params, 'save_shift_plan', { siteId: f.siteId, weekStart, expectedVersion: 0, sourceRevision, slots, assignments });
}
const employee = (id: string) => f.db.run(f.hr.params, (ctx) => repo(ctx, WorkforceEmployee).get(id));
describe('shift planner preserves live constraints and employment history', () => {
  it('flags published work after pending leave without disclosing the reason, and revalidates revisions', async () => {
    const weekStart = '2026-09-14', row = await draft(f, weekStart); await publish(f, row);
    await call(f.db, f.hr.params, 'grant_leave', { employeeId: f.employee.id, validFrom: '2026-09-01', expiresOn: '2026-12-31', days: '2', eligibilityConfirmed: true, basis: '資格を確認' });
    const request = await call(f.db, f.alice.params, 'request_leave', { leaveDate: weekStart, portion: 'morning', reason: '公開しない個人的な事情', idempotencyKey: newId() });
    const source = await board(f, weekStart);
    expect(source.problem.leave).toEqual([{ employeeId: f.employee.id, date: weekStart, portion: 'morning', status: 'pending' }]);
    expect(JSON.stringify(source)).not.toContain('公開しない個人的な事情');
    expect(source.publishedEvaluation?.issues).toContainEqual(expect.objectContaining({ code: 'leave', employeeId: f.employee.id }));
    await expect(save(weekStart, source.sourceRevision)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await mine(f, weekStart)).assignments).toHaveLength(1);
    await call(f.db, f.manager.params, 'review_leave', { requestId: request.id, expectedVersion: request.version, decision: 'approve', halfDayAgreement: true, reason: '半日取得に合意' });
    const approved = await board(f, weekStart);
    expect(approved.problem.leave[0]?.status).toBe('approved'); expect(approved.sourceRevision).not.toBe(source.sourceRevision);
  });
  it('detects conditions changed after draft save and applies the stricter individual limit', async () => {
    const weekStart = '2026-10-12', row = await draft(f, weekStart), own = defined((await mine(f, weekStart)).profile);
    const updated = await call(f.db, f.manager.params, 'save_shift_profile', { employeeId: f.employee.id, expectedVersion: own.version, profile: { ...profile, maxDailyMinutes: 120 } });
    await expect(publish(f, row)).rejects.toMatchObject({ code: 'CONFLICT' });
    const current = await board(f, weekStart);
    await expect(call(f.db, f.manager.params, 'save_shift_plan', { siteId: f.siteId, weekStart, planId: row.id, expectedVersion: row.version, sourceRevision: current.sourceRevision, slots: [slot(weekStart)], assignments: [assignment(f.employee.id)] })).rejects.toMatchObject({ code: 'VALIDATION' });
    await call(f.db, f.manager.params, 'save_shift_profile', { employeeId: f.employee.id, expectedVersion: updated.version, profile });
    expect((await board(f, weekStart)).draft?.version).toBe(row.version);
  });
  it('includes adjacent published days and rejects a rest conflict across the week boundary', async () => {
    const previousWeek = '2026-11-02', weekStart = '2026-11-09', source = await ready(f, previousWeek);
    const late = { ...slot(addDays(previousWeek, 6)), startMinute: 1200, endMinute: 1440 };
    const previous = await save(previousWeek, source.sourceRevision, [late]); await publish(f, { ...previous, sourceRevision: source.sourceRevision });
    const next = await ready(f, weekStart);
    expect(next.problem.existing).toContainEqual({ employeeId: f.employee.id, date: late.date, startMinute: 1200, endMinute: 1440, breakMinutes: 0 });
    await expect(save(weekStart, next.sourceRevision)).rejects.toMatchObject({ code: 'VALIDATION' });
    const safe = await save(weekStart, next.sourceRevision, [slot(weekStart)], [assignment(f.otherEmployee.id)]);
    await publish(f, { ...safe, sourceRevision: next.sourceRevision });
    const current = await board(f, weekStart);
    expect(current.problem.existing.every((row) => row.date < weekStart || row.date > addDays(weekStart, 6))).toBe(true);
  });
  it('serializes concurrent publish and refuses stale draft edits without changing public history', async () => {
    const weekStart = '2026-12-07', row = await draft(f, weekStart);
    const outcomes = await Promise.allSettled([publish(f, row), publish(f, row)]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(await f.db.run(f.manager.params, (ctx) => repo(ctx, WorkforceShiftAssignment).count({ planId: row.id }))).toBe(1);
    const current = await board(f, weekStart);
    await expect(call(f.db, f.manager.params, 'cancel_shift_plan', { planId: row.id, expectedVersion: row.version, reason: '古い画面の取消' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await board(f, weekStart)).published).toEqual(current.published);
  });
  it('protects published commitments and site history during employee lifecycle changes', async () => {
    const before = await employee(f.otherEmployee.id), members = await f.db.owner.drizzle.select().from(companyMemberships);
    for (const change of [{ active: false }, { terminatedOn: '2026-11-08' }, { siteId: f.otherSiteId }]) {
      await expect(f.db.run({ ...f.hr.params, ...at(NOW) }, (ctx) => repo(ctx, WorkforceEmployee).update(before.id, change, { expectedVersion: before.version }))).rejects.toBeDefined();
      expect(await employee(before.id)).toEqual(before);
    }
    expect(await f.db.owner.drizzle.select().from(companyMemberships)).toEqual(members);
    const publicRows = await f.db.run(f.manager.params, (ctx) => repo(ctx, WorkforceShiftAssignment).list({ where: { employeeId: before.id, active: true } }));
    expect(publicRows.items).toHaveLength(1);
  });
  it('serializes site deactivation against publication and preserves a consistent active site', async () => {
    const weekStart = '2027-02-01', row = await draft(f, weekStart);
    const site = await f.db.run(f.hr.params, (ctx) => repo(ctx, WorkforceSite).get(f.siteId));
    const outcomes = await Promise.allSettled([
      publish(f, row),
      f.db.run({ ...f.hr.params, ...at(NOW) }, (ctx) => repo(ctx, WorkforceSite).update(site.id, { active: false }, { expectedVersion: site.version })),
    ]);
    // Other future published rows already prohibit deactivation; the raced plan still publishes safely.
    expect(outcomes[0]?.status).toBe('fulfilled'); expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { code: 'INVALID_STATE' } });
    expect((await f.db.run(f.hr.params, (ctx) => repo(ctx, WorkforceSite).get(site.id))).active).toBe(true);
  });
  it('denies cross-company and cross-tenant planning with no snapshot disclosure', async () => {
    const otherCompanyId = newId();
    await f.db.owner.drizzle.insert(companies).values({ id: otherCompanyId, tenantId: f.db.tenantId, code: 'OTHER', name: '別会社' });
    const other = await bootstrapTenant(f.db.owner, { tenantName: 'Other tenant', companyCode: 'OT', companyName: '別テナント会社', adminEmail: 'other-shift@example.com', adminName: 'Other', adminPassword: 'test-password' });
    for (const scope of [{ companyId: otherCompanyId }, { tenantId: other.tenantId, companyId: other.companyId }]) {
      await expect(f.db.run({ ...f.manager.params, ...scope }, (ctx) => runAction(ctx, 'workforce.shift_board', { siteId: f.siteId, weekStart: '2026-09-14' }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });
  it('refuses an unsupported company workweek without silently changing weekly limits', async () => {
    const policy = defined((await f.db.run(f.hr.params, (ctx) => repo(ctx, WorkforcePayPolicy).list())).items[0]);
    const modified = await f.db.run(f.hr.params, (ctx) => repo(ctx, WorkforcePayPolicy).update(policy.id, { weekStartsOn: 0 }, { expectedVersion: policy.version }));
    await expect(board(f, '2026-09-14')).rejects.toMatchObject({ code: 'INVALID_STATE', message: 'シフト推薦は月曜始まりの会社制度に対応しています' });
    await f.db.run(f.hr.params, (ctx) => repo(ctx, WorkforcePayPolicy).update(policy.id, { weekStartsOn: 1 }, { expectedVersion: modified.version }));
  });
  it('permits a no-history transfer with parent-scoped conditions and prepares future hires', async () => {
    const person = await f.person('future-shift', 'workforce_employee');
    const row = await call(f.db, f.hr.params, 'register_employee', { userId: person.id, siteId: f.siteId, code: 'FUTURE', name: '来月入社', hiredOn: '2026-10-01' });
    const saved = await call(f.db, f.manager.params, 'save_shift_profile', { employeeId: row.id, expectedVersion: 0, profile });
    const moved = await f.db.run(f.hr.params, (ctx) => repo(ctx, WorkforceEmployee).update(row.id, { siteId: f.otherSiteId }, { expectedVersion: row.version }));
    expect(moved.siteId).toBe(f.otherSiteId);
    expect((await f.db.run(f.remote.params, (ctx) => repo(ctx, WorkforceShiftProfile).get(saved.id))).employeeId).toBe(row.id);
    await expect(f.db.run(f.manager.params, (ctx) => repo(ctx, WorkforceShiftProfile).get(saved.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const weekStart = '2026-10-12';
    await call(f.db, { ...person.params, siteIds: [f.otherSiteId] }, 'save_shift_availability', { weekStart, expectedVersion: 0, days: availability(weekStart) });
    const own = await f.db.run({ ...person.params, siteIds: [f.otherSiteId] }, (ctx) => runAction(ctx, 'workforce.my_shifts', { weekStart }));
    expect(own).toMatchObject({ employee: { id: row.id }, availability: { employeeId: row.id } });
    expect(await f.db.run({}, (ctx) => repo(ctx, WorkforceShiftPlan).count({ siteId: f.otherSiteId }))).toBe(0);
  });
});
