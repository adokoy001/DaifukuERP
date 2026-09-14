import { defineAction, label, repo, StateError, withLock } from '@daifuku/kernel';
import {
  saveWorkSystemInput,
  confirmWorkSystemInput,
  cancelWorkSystemInput,
  workSystemBoardInput,
  workSystemBoardOutput,
  workSystemData,
  workSystemSummary,
} from '../work-system-contract.ts';
import {
  WorkforceEmployee,
  WorkforceSite,
  WorkforceShiftAssignment,
  WorkforceWorkSystemPeriod,
} from '../entities/index.ts';
import { H, M } from '../entities/common.ts';
import { allRows, command, employeeLock, expectVersion, identity, requireOther, reviewed } from '../common.ts';
import { internalWrite } from '../internal.ts';
import { assertWorkforcePeriodOpen } from '../period-lock.ts';
import { validateWorkSystem } from '../services/work-system.ts';
import { jstDate, periodBounds } from '../services/time.ts';
import { workflowAction } from './define.ts';
export const saveWorkSystemAction = workflowAction(
  'save_work_system',
  '社員の勤務制度と事前所定を保存',
  saveWorkSystemInput,
  [M, H],
  (ctx, input) =>
    withLock(ctx, 'workforce:policies', () =>
      employeeLock(ctx, input.employeeId, async () => {
        const employee = await repo(ctx, WorkforceEmployee).get(input.employeeId);
        const prior = input.periodId ? await repo(ctx, WorkforceWorkSystemPeriod).get(input.periodId) : null;
        if (prior && (prior.employeeId !== employee.id || prior.status !== 'draft'))
          throw new StateError('この勤務制度は下書きとして編集できません', '対象社員の下書きを選択してください。');
        expectVersion(prior?.version ?? 0, input.expectedVersion);
        const { periodId: _id, expectedVersion: _version, ...raw } = input;
        const values = workSystemData.parse(raw);
        validateWorkSystem(values);
        if (employee.hiredOn > values.startsOn || (employee.terminatedOn && employee.terminatedOn < values.endsOn))
          throw new StateError(
            '清算期間の途中入退社には対応していません',
            '全期間に在籍する社員の制度を事前設定してください。',
          );
        const overlaps = await allRows(ctx, WorkforceWorkSystemPeriod, {
          employeeId: employee.id,
          status: { $in: ['draft', 'confirmed'] },
          startsOn: { $lte: values.endsOn },
          endsOn: { $gte: values.startsOn },
        });
        if (overlaps.some((row) => row.id !== prior?.id))
          throw new StateError(
            '勤務制度の清算期間が重複します',
            '同じ社員の重複する下書き・確定期間を整理してください。',
          );
        return command(
          await internalWrite(ctx, WorkforceWorkSystemPeriod, (write) =>
            prior
              ? repo(write, WorkforceWorkSystemPeriod).update(prior.id, values, { expectedVersion: prior.version })
              : repo(write, WorkforceWorkSystemPeriod).create({ ...identity(employee), ...values }),
          ),
        );
      }),
    ),
);
export const confirmWorkSystemAction = workflowAction(
  'confirm_work_system',
  '開始前に労使合意と事前所定を確定',
  confirmWorkSystemInput,
  [M, H],
  async (ctx, input) => {
    const initial = await repo(ctx, WorkforceWorkSystemPeriod).get(input.periodId);
    return withLock(ctx, 'workforce:policies', () =>
      employeeLock(ctx, initial.employeeId, async () => {
        const row = await repo(ctx, WorkforceWorkSystemPeriod).get(initial.id);
        requireOther(ctx, row);
        expectVersion(row.version, input.expectedVersion);
        if (row.status !== 'draft' || row.startsOn <= jstDate(ctx.now()))
          throw new StateError(
            '勤務制度は開始前の下書きだけを確定できます',
            '労使合意・協定と全日所定を制度開始前に確認してください。',
          );
        const employee = await repo(ctx, WorkforceEmployee).get(row.employeeId);
        if (
          !employee.active ||
          employee.hiredOn > row.startsOn ||
          (employee.terminatedOn && employee.terminatedOn < row.endsOn) ||
          !(await repo(ctx, WorkforceSite).get(employee.siteId)).active
        )
          throw new StateError(
            '社員または拠点の条件が保存後に変更されています',
            '全期間に在籍する社員と有効な拠点を確認し、下書きを修正してください。',
          );
        validateWorkSystem(workSystemData.strip().parse(row));
        await assertWorkforcePeriodOpen(ctx, row.employeeId, row.startsOn);
        await assertWorkforcePeriodOpen(ctx, row.employeeId, row.endsOn);
        if (
          await repo(ctx, WorkforceShiftAssignment).count({
            employeeId: row.employeeId,
            active: true,
            date: { $gte: row.startsOn, $lte: row.endsOn },
          })
        )
          throw new StateError(
            '清算期間に公開済みシフトがあります',
            '勤務制度はシフト公開前に確定してください。既存の公開計画を取り消して整合を確認してください。',
          );
        return command(
          await internalWrite(ctx, WorkforceWorkSystemPeriod, (write) =>
            repo(write, WorkforceWorkSystemPeriod).update(
              row.id,
              { status: 'confirmed', confirmedAt: ctx.now(), ...reviewed(ctx, input.reason) },
              { expectedVersion: row.version },
            ),
          ),
        );
      }),
    );
  },
);
export const cancelWorkSystemAction = workflowAction(
  'cancel_work_system',
  '開始前の勤務制度を理由付きで取消',
  cancelWorkSystemInput,
  [M, H],
  async (ctx, input) => {
    const initial = await repo(ctx, WorkforceWorkSystemPeriod).get(input.periodId);
    return withLock(ctx, 'workforce:policies', () =>
      employeeLock(ctx, initial.employeeId, async () => {
        const row = await repo(ctx, WorkforceWorkSystemPeriod).get(initial.id);
        requireOther(ctx, row);
        expectVersion(row.version, input.expectedVersion);
        if (row.status === 'cancelled' || (row.status === 'confirmed' && row.startsOn <= jstDate(ctx.now())))
          throw new StateError(
            '開始後の確定勤務制度は取り消せません',
            '既に適用した制度・所定と給与の根拠を保持します。将来の次期間を登録してください。',
          );
        if (
          await repo(ctx, WorkforceShiftAssignment).count({
            employeeId: row.employeeId,
            active: true,
            date: { $gte: row.startsOn, $lte: row.endsOn },
          })
        )
          throw new StateError('勤務制度に公開済みシフトが依存しています', '先に公開計画の状態を整理してください。');
        return command(
          await internalWrite(ctx, WorkforceWorkSystemPeriod, (write) =>
            repo(write, WorkforceWorkSystemPeriod).update(
              row.id,
              { status: 'cancelled', ...reviewed(ctx, input.reason) },
              { expectedVersion: row.version },
            ),
          ),
        );
      }),
    );
  },
);
export const workSystemBoardAction = defineAction({
  name: 'workforce.work_system_board',
  description: label('社員の勤務制度と清算期間', 'Employee work systems and settlement periods'),
  input: workSystemBoardInput,
  output: workSystemBoardOutput,
  permission: { roles: [M, H] },
  siteAccess: true,
  tx: 'none',
  mutates: false,
  async handler(ctx, input) {
    const bounds = periodBounds(input.period);
    const employees = await allRows(ctx, WorkforceEmployee);
    const periods = await allRows(ctx, WorkforceWorkSystemPeriod, {
      startsOn: { $lte: bounds.end },
      endsOn: { $gte: bounds.start },
    });
    return workSystemBoardOutput.parse({
      employees: employees.map(({ id, name, code, siteId }) => ({ id, name, code, siteId })),
      periods: periods.map((row) =>
        workSystemSummary.strip().parse({ ...row, confirmedAt: row.confirmedAt?.toISOString() ?? null }),
      ),
    });
  },
});
