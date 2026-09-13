import { repo, StateError, withLock } from '@daifuku/kernel';
import { z } from 'zod';
import {
  payrollConditionData,
  payrollTaxEvidenceInput,
  savePayrollConditionInput,
  statutoryPayrollInput,
  supersedePayrollConditionInput,
} from '../fiscal-contract.ts';
import {
  WorkforceEmployee,
  WorkforcePayroll,
  WorkforcePayrollCondition,
  WorkforcePayrollRules,
} from '../entities/index.ts';
import { P } from '../entities/common.ts';
import { allRows, command, D, employeeLock, expectVersion, requireOther } from '../common.ts';
import { internalWrite } from '../internal.ts';
import { assertYearOpen, statutoryEnvelope, statutorySource } from '../fiscal-source.ts';
import { FISCAL_CODE, FISCAL_DATA, FISCAL_SOURCES } from '../services/fiscal-data.ts';
import { stableJson } from '../services/json.ts';
import { addDays, periodBounds } from '../services/time.ts';
import { validateCondition } from '../services/social-insurance.ts';
import { createTaxEvidence } from '../fiscal-evidence.ts';
import { calculatePayroll } from './payroll.ts';
import { workflowAction } from './define.ts';
export const initializePayrollRulesAction = workflowAction(
  'initialize_payroll_rules',
  '2026年の給与制度資料を準備',
  z.object({}).strict(),
  [P],
  (ctx) =>
    withLock(ctx, 'workforce:policies', async () => {
      const found = (await allRows(ctx, WorkforcePayrollRules, { code: FISCAL_CODE }))[0];
      if (found) return command(found);
      return command(
        await internalWrite(ctx, WorkforcePayrollRules, (write) =>
          repo(write, WorkforcePayrollRules).create({
            code: FISCAL_CODE,
            taxYear: 2026,
            data: FISCAL_DATA,
            sources: FISCAL_SOURCES,
            verifiedOn: FISCAL_DATA.verifiedOn,
          }),
        ),
      );
    }),
  false,
);
export const savePayrollConditionAction = workflowAction(
  'save_payroll_condition',
  '税・保険の確認済み本人条件を保存',
  savePayrollConditionInput,
  [P],
  (ctx, input) =>
    employeeLock(ctx, input.employeeId, async () => {
      await repo(ctx, WorkforceEmployee).get(input.employeeId);
      const { conditionId, employeeId, expectedVersion, ...raw } = input,
        condition = payrollConditionData.parse(raw);
      validateCondition(condition);
      const prior = conditionId ? await repo(ctx, WorkforcePayrollCondition).get(conditionId) : null;
      if (prior && prior.employeeId !== employeeId)
        throw new StateError('本人条件の社員が一致しません', '対象の社員を選び直してください。');
      expectVersion(prior?.version ?? 0, expectedVersion);
      const overlapping = await allRows(ctx, WorkforcePayrollCondition, {
        employeeId,
        validFrom: { $lte: condition.validTo },
        validTo: { $gte: condition.validFrom },
      });
      if (overlapping.some((row) => row.id !== prior?.id))
        throw new StateError(
          '本人条件の適用期間が重複します',
          '日付ごとに一つの確認済み条件が適用されるよう期間を分けてください。',
        );
      const frozen = await allRows(ctx, WorkforcePayroll, { employeeId, docstatus: 1 });
      if (prior && frozen.some((row) => stableJson(statutoryEnvelope(row.calculation)?.evidence).includes(prior.id)))
        throw new StateError(
          '確定給与で使用した本人条件は変更できません',
          '元の給与を取り消して訂正するか、未使用の将来期間の条件を追加してください。',
        );
      const values = { validFrom: condition.validFrom, validTo: condition.validTo, condition };
      return command(
        await internalWrite(ctx, WorkforcePayrollCondition, (write) =>
          prior
            ? repo(write, WorkforcePayrollCondition).update(prior.id, values, { expectedVersion: prior.version })
            : repo(write, WorkforcePayrollCondition).create({ employeeId, ...values }),
        ),
      );
    }),
  false,
);
export const calculateStatutoryPayrollAction = workflowAction(
  'calculate_statutory_payroll',
  '勤怠給与と2026年の税・保険料を自動計算',
  statutoryPayrollInput,
  [P],
  (ctx, input) =>
    withLock(ctx, 'workforce:policies', () =>
      employeeLock(ctx, input.employeeId, async () => {
        await assertYearOpen(ctx, input.employeeId, Number(input.paymentDate.slice(0, 4)));
        const result = await calculatePayroll(ctx, {
          employeeId: input.employeeId,
          period: input.period,
          expectedVersion: input.expectedVersion,
          attendanceCompleteConfirmed: true,
        });
        const row = await repo(ctx, WorkforcePayroll).get(result.id),
          source = await statutorySource(ctx, input, row);
        const calculation = {
          ...(row.calculation as Record<string, unknown>),
          statutory: { input, evidence: source.evidence },
        };
        return command(
          await internalWrite(ctx, WorkforcePayroll, (write) =>
            repo(write, WorkforcePayroll).update(
              row.id,
              {
                grossPay: source.grossPay,
                deductionTotal: source.deductionTotal,
                netPay: source.netPay,
                deductions: source.deductions,
                allowances: source.allowances,
                calculation,
              },
              { expectedVersion: row.version },
            ),
          ),
        );
      }),
    ),
  false,
);
export const recordPayrollTaxEvidenceAction = workflowAction(
  'record_payroll_tax_evidence',
  '既存確定給与に支払日と課税支給額の証跡を登録',
  payrollTaxEvidenceInput,
  [P],
  async (ctx, input) => {
    const initial = await repo(ctx, WorkforcePayroll).get(input.payrollId);
    return employeeLock(ctx, initial.employeeId, async () => {
      const row = await repo(ctx, WorkforcePayroll).get(initial.id);
      requireOther(ctx, row);
      if (row.docstatus !== 1 || statutoryEnvelope(row.calculation))
        throw new StateError('通常の既存確定給与を選択してください', '自動計算給与の証跡は給与確定時に登録されます。');
      if (
        input.paymentDate < row.periodEnd ||
        input.paymentDate.slice(0, 7) > addDays(row.periodEnd, 1).slice(0, 7) ||
        D(input.taxablePay).gt(row.grossPay)
      )
        throw new StateError(
          '支払日または課税支給額が元給与と整合しません',
          '給与月または翌月の支払日と、総支給以下の課税支給額を原資料で確認してください。',
        );
      return command(await createTaxEvidence(ctx, row, input));
    });
  },
  false,
);

export const supersedePayrollConditionAction = workflowAction(
  'supersede_payroll_condition',
  '使用済みの本人条件を保全して将来条件へ切替',
  supersedePayrollConditionInput,
  [P],
  (ctx, input) =>
    employeeLock(ctx, input.employeeId, async () => {
      const prior = await repo(ctx, WorkforcePayrollCondition).get(input.conditionId);
      expectVersion(prior.version, input.expectedVersion);
      if (
        prior.employeeId !== input.employeeId ||
        input.validFrom <= prior.validFrom ||
        input.validFrom > prior.validTo ||
        input.validTo !== prior.validTo
      )
        throw new StateError(
          '条件切替の期間が不正です',
          '切替元の期間内で新開始日を選び、終期は元条件と同じにしてください。',
        );
      const { conditionId: _id, employeeId, expectedVersion: _version, ...raw } = input,
        condition = payrollConditionData.parse(raw);
      validateCondition(condition);
      const frozen = await allRows(ctx, WorkforcePayroll, { employeeId, docstatus: 1 });
      for (const payroll of frozen) {
        const envelope = statutoryEnvelope(payroll.calculation);
        if (!envelope || !envelope.evidence || typeof envelope.evidence !== 'object') continue;
        const evidence = envelope.evidence as Record<string, { id?: string }>;
        const used = [
          [evidence['taxCondition']?.id, envelope.input.paymentDate],
          [evidence['insuranceCondition']?.id, periodBounds(envelope.input.insurancePeriod).end],
          [evidence['employmentCondition']?.id, periodBounds(envelope.input.period).end],
        ];
        if (used.some(([id, date]) => id === prior.id && date && date >= input.validFrom))
          throw new StateError(
            '新条件開始日以降に元条件を使用した確定給与があります',
            'その給与を取り消して訂正するか、最後に使用した日より後から切り替えてください。',
          );
      }
      const validTo = addDays(input.validFrom, -1),
        oldCondition = { ...payrollConditionData.parse(prior.condition), validTo };
      await internalWrite(ctx, WorkforcePayrollCondition, (write) =>
        repo(write, WorkforcePayrollCondition).update(
          prior.id,
          { validTo, condition: oldCondition },
          { expectedVersion: prior.version },
        ),
      );
      return command(
        await internalWrite(ctx, WorkforcePayrollCondition, (write) =>
          repo(write, WorkforcePayrollCondition).create({
            employeeId,
            validFrom: condition.validFrom,
            validTo: condition.validTo,
            condition,
          }),
        ),
      );
    }),
  false,
);
