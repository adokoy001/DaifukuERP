import { repo, StateError, type Context, type Infer } from '@daifuku/kernel';
import { allRows } from './common.ts';
import { WorkforceEmployee, WorkforceLeaveRequest, WorkforcePayPolicy, WorkforceShiftAssignment, WorkforceShiftAvailability, WorkforceShiftPlan, WorkforceShiftProfile, WorkforceSite } from './entities/index.ts';
import { shiftAvailabilitySummary, shiftPlanSummary, shiftProfileSummary } from './shift-contract.ts';
import type { ShiftProblem } from './scheduling/types.ts';
import { addDays } from './services/time.ts';
import { stableJson } from './services/json.ts';
export const planSummary = (row: Infer<typeof WorkforceShiftPlan>) => shiftPlanSummary.parse({ ...row, publishedAt: row.publishedAt?.toISOString() ?? null });
export async function shiftSource(ctx: Context, siteId: string, weekStart: string) {
  const site = await repo(ctx, WorkforceSite).get(siteId), end = addDays(weekStart, 6);
  if (!site.active) throw new StateError('The work site is inactive', 'Choose an active site.');
  const employees = await allRows(ctx, WorkforceEmployee, { siteId }, [{ field: 'id' }]);
  if (employees.length > 100) throw new StateError('Shift planning supports up to 100 employees per site', 'Use an appropriately sized work site.');
  const ids = employees.map((row) => row.id), people = { employeeId: { $in: ids } };
  const profiles = await allRows(ctx, WorkforceShiftProfile, people);
  const availability = await allRows(ctx, WorkforceShiftAvailability, { ...people, weekStart });
  const leave = await allRows(ctx, WorkforceLeaveRequest, { ...people, leaveDate: { $gte: weekStart, $lte: end }, status: { $in: ['pending', 'approved'] } });
  const assignments = await allRows(ctx, WorkforceShiftAssignment, { siteId, active: true, date: { $gte: addDays(weekStart, -6), $lte: addDays(end, 6) } });
  const policies = await allRows(ctx, WorkforcePayPolicy, { validFrom: { $lte: end }, validTo: { $gte: weekStart } });
  const plans = await allRows(ctx, WorkforceShiftPlan, { siteId, weekStart, status: { $in: ['draft', 'published'] } });
  if (plans.filter((row) => row.status === 'draft').length > 1 || plans.filter((row) => row.status === 'published').length > 1) throw new StateError('Multiple current shift plans exist', 'Ask headquarters to review plan history.');
  const profileDtos = profiles.map((row) => shiftProfileSummary.parse(row)), availabilityDtos = availability.map((row) => shiftAvailabilitySummary.parse(row));
  const rules = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index), found = policies.filter((row) => row.validFrom <= date && row.validTo >= date);
    const policy = found[0];
    if (found.length !== 1 || !policy) throw new StateError('A unique working-time policy is required for each planning day', 'Configure the company policy for the complete week.');
    if (policy.weekStartsOn !== 1) throw new StateError('シフト推薦は月曜始まりの会社制度に対応しています', '現在の週の起算日には対応していません。会社制度を変更せず、対応する勤務計画方法を使用してください。');
    const { dailyLimitMinutes, weeklyLimitMinutes, breakAfterMinutes, breakMinutes, longBreakAfterMinutes, longBreakMinutes } = policy;
    return { date, dailyLimitMinutes, weeklyLimitMinutes, breakAfterMinutes, breakMinutes, longBreakAfterMinutes, longBreakMinutes };
  });
  const problem: ShiftProblem = {
    weekStart, slots: [], employees: employees.map(({ id, code, name, active, hiredOn, terminatedOn }) => ({ id, code, name, active, hiredOn, terminatedOn, profile: profileDtos.find((profile) => profile.employeeId === id)?.profile ?? null })),
    availability: availabilityDtos.flatMap((row) => row.days.map((day) => ({ ...day, employeeId: row.employeeId }))),
    leave: leave.map((row) => ({ employeeId: row.employeeId, date: row.leaveDate, portion: row.portion, status: row.status as 'pending' | 'approved' })),
    existing: assignments.filter((row) => row.date < weekStart || row.date > end).map(({ employeeId, date, startMinute, endMinute, breakMinutes }) => ({ employeeId, date, startMinute, endMinute, breakMinutes })), rules,
  };
  const revisions = Object.entries({ site: [site], employees, profiles, availability, leave, assignments, policies, published: plans.filter((row) => row.status === 'published') }).map(([kind, rows]) => [kind, rows.map(({ id, version }) => ({ id, version })).sort((a, b) => a.id.localeCompare(b.id))]);
  return { site: { id: site.id, code: site.code, name: site.name }, employees, profiles: profileDtos, availability: availabilityDtos, plans, problem, sourceRevision: stableJson(revisions) };
}
