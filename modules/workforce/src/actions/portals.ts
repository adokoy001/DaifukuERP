import { can, companyMemberIdentities, defineAction, label, repo, StateError } from '@daifuku/kernel';
import { z } from 'zod';
import { managementPortalInput, managementPortalOutput, myPortalInput, myPortalOutput } from '../contract.ts';
import { E, H, M, P } from '../entities/common.ts';
import { WorkforceAttendance, WorkforceEmployee, WorkforcePayPolicy, WorkforceSite } from '../entities/index.ts';
import { allRows, command, userId } from '../common.ts';
import { portalData } from '../portal-data.ts';
import { leaveBalance } from '../leave-balance.ts';
import { jstDate, minutesDisplay } from '../services/time.ts';
import { seedWorkforce } from '../seed.ts';
import { workflowAction } from './define.ts';

export const myPortalAction = defineAction({
  name: 'workforce.my_portal',
  description: label('自分の勤怠・申請・給与明細', 'My attendance, requests and payslips'),
  input: myPortalInput,
  output: myPortalOutput,
  permission: { roles: [E, M, H, P] },
  siteAccess: true,
  tx: 'none',
  mutates: false,
  async handler(ctx, input) {
    const today = jstDate(ctx.now()),
      period = input.period ?? today.slice(0, 7);
    const self = (await repo(ctx, WorkforceEmployee).list({ where: { userId: userId(ctx) }, limit: 1 })).items[0];
    if (!self)
      return {
        today,
        period,
        employee: null,
        attendance: null,
        attendances: [],
        corrections: [],
        leaveBalance: '0',
        leaveRequests: [],
        expenses: [],
        payrolls: [],
      };
    const data = await portalData(ctx, period, self.id);
    const current = (
      await allRows(
        ctx,
        WorkforceAttendance,
        { employeeId: self.id, $or: [{ workDate: today }, { status: { $in: ['working', 'break'] } }] },
        [{ field: 'workDate', dir: 'desc' }],
      )
    )[0];
    const attendance = current
      ? {
          ...current,
          employeeName: self.name,
          clockIn: current.clockIn.toISOString(),
          clockOut: current.clockOut?.toISOString() ?? null,
          breakStartedAt: current.breakStartedAt?.toISOString() ?? null,
          workedMinutes: minutesDisplay(current.workedMs),
          nightMinutes: minutesDisplay(current.nightMs),
        }
      : null;
    return myPortalOutput.parse({
      ...data,
      today,
      period,
      employee: data.employees[0],
      attendance,
      leaveBalance: (await leaveBalance(ctx, self.id, today)).toString(),
    });
  },
});
export const managementPortalAction = defineAction({
  name: 'workforce.management_portal',
  description: label('拠点と本部の労務管理', 'Workforce management'),
  input: managementPortalInput,
  output: managementPortalOutput,
  permission: { roles: [M, H, P] },
  siteAccess: true,
  tx: 'none',
  mutates: false,
  async handler(ctx, input) {
    const period = input.period ?? jstDate(ctx.now()).slice(0, 7),
      data = await portalData(ctx, period);
    const sites = (await allRows(ctx, WorkforceSite)).map(({ id, code, name }) => ({ id, code, name }));
    const users = can(ctx, WorkforceEmployee, 'create')
      ? await companyMemberIdentities(ctx, WorkforceEmployee.name)
      : [];
    return managementPortalOutput.parse({ period, ...data, sites, users });
  },
});
export const initializePolicyAction = workflowAction(
  'initialize_policy',
  '通常労働時間制の初期制度を準備（既存制度を保持）',
  z.object({}).strict(),
  [H, P],
  async (ctx) => {
    await seedWorkforce(ctx);
    const row = (await repo(ctx, WorkforcePayPolicy).list({ limit: 1, orderBy: [{ field: 'validFrom' }] })).items[0];
    if (!row) throw new StateError('Policy initialization failed', 'Check the company policy settings.');
    return { ...command(row), status: 'ready' };
  },
  false,
);
