import { defineAction, label, repo } from '@daifuku/kernel';
import { E, H, M, P } from '../entities/common.ts';
import { WorkforceEmployee, WorkforceShiftAssignment, WorkforceShiftAvailability, WorkforceShiftProfile } from '../entities/index.ts';
import { allRows, userId } from '../common.ts';
import { myShiftsInput, myShiftsOutput, shiftBoardInput, shiftBoardOutput } from '../shift-contract.ts';
import { planSummary, shiftSource } from '../shift-source.ts';
import { evaluateShift } from '../scheduling/index.ts';
import { addDays } from '../services/time.ts';
export const shiftBoardAction = defineAction({
  name: 'workforce.shift_board', description: label('拠点の週間シフト計画', 'Site weekly shift planner'), input: shiftBoardInput, output: shiftBoardOutput, permission: { roles: [M, H] }, siteAccess: true, tx: 'none', mutates: false,
  async handler(ctx, input) {
    const source = await shiftSource(ctx, input.siteId, input.weekStart);
    const draftRow = source.plans.find((row) => row.status === 'draft'), publishedRow = source.plans.find((row) => row.status === 'published');
    const draft = draftRow ? planSummary(draftRow) : null, published = publishedRow ? planSummary(publishedRow) : null;
    return shiftBoardOutput.parse({ ...source, weekStart: input.weekStart, problem: { ...source.problem, slots: draft?.slots ?? published?.slots ?? [] }, employeeVersions: source.employees.map(({ id, version }) => ({ employeeId: id, version })), draft, published, publishedEvaluation: published ? evaluateShift({ ...source.problem, slots: published.slots }, published.assignments) : null });
  },
});
export const myShiftsAction = defineAction({
  name: 'workforce.my_shifts', description: label('自分の勤務希望と公開シフト', 'My availability and published shifts'), input: myShiftsInput, output: myShiftsOutput, permission: { roles: [E, M, H, P] }, siteAccess: true, tx: 'none', mutates: false,
  async handler(ctx, input) {
    const employee = (await repo(ctx, WorkforceEmployee).list({ where: { userId: userId(ctx) }, limit: 1 })).items[0];
    if (!employee) return { weekStart: input.weekStart, employee: null, profile: null, availability: null, assignments: [] };
    const profile = (await repo(ctx, WorkforceShiftProfile).list({ where: { employeeId: employee.id }, limit: 1 })).items[0] ?? null;
    const availability = (await repo(ctx, WorkforceShiftAvailability).list({ where: { employeeId: employee.id, weekStart: input.weekStart }, limit: 1 })).items[0] ?? null;
    const assignments = await allRows(ctx, WorkforceShiftAssignment, { employeeId: employee.id, active: true, date: { $gte: input.weekStart, $lte: addDays(input.weekStart, 6) } }, [{ field: 'date' }, { field: 'startMinute' }]);
    return myShiftsOutput.parse({ weekStart: input.weekStart, employee, profile, availability, assignments });
  },
});
