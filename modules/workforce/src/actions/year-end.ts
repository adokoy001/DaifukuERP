import { cancelDocument, repo, StateError, submitDocument, withLock } from '@daifuku/kernel';
import {
  calculateYearEndInput,
  cancelYearEndInput,
  confirmYearEndInput,
  reviewYearEndDeclarationInput,
  settleYearEndInput,
  submitYearEndDeclarationInput,
  yearEndDeclarationData,
} from '../fiscal-contract.ts';
import { WorkforceEmployee, WorkforceYearEndAdjustment, WorkforceYearEndDeclaration } from '../entities/index.ts';
import { E, H, M, P } from '../entities/common.ts';
import {
  allRows,
  command,
  employeeLock,
  expectVersion,
  identity,
  requireOther,
  requireSelf,
  reviewed,
  selfEmployee,
} from '../common.ts';
import { internalWrite } from '../internal.ts';
import { assertYearOpen } from '../fiscal-source.ts';
import { yearEndSnapshotSchema, yearEndSource } from '../year-end-source.ts';
import { jstDate } from '../services/time.ts';
import { supportedPayrollTaxYears } from '../payroll-rules/resolver.ts';
import { stableJson } from '../services/json.ts';
import { workflowAction } from './define.ts';
export const submitYearEndDeclarationAction = workflowAction(
  'submit_year_end_declaration',
  '自分の年末調整申告を提出',
  submitYearEndDeclarationInput,
  [E, M, H, P],
  async (ctx, input) => {
    const initial = await selfEmployee(ctx);
    return employeeLock(ctx, initial.id, async () => {
      const employee = await repo(ctx, WorkforceEmployee).get(initial.id);
      requireSelf(ctx, employee);
      await assertYearOpen(ctx, employee.id, input.taxYear);
      if (!(await supportedPayrollTaxYears(ctx)).includes(input.taxYear))
        throw new StateError(
          'この税年の制度資料が導入されていません',
          '給与本部で対応する制度版の導入を確認してください。',
        );
      const prior = (
        await allRows(ctx, WorkforceYearEndDeclaration, { employeeId: employee.id, taxYear: input.taxYear })
      )[0];
      expectVersion(prior?.version ?? 0, input.expectedVersion);
      const { expectedVersion: _version, ...raw } = input,
        declaration = yearEndDeclarationData.parse(raw);
      const values = {
        declaration,
        status: 'submitted' as const,
        reviewedBy: null,
        reviewedAt: null,
        reviewReason: null,
      };
      return command(
        await internalWrite(ctx, WorkforceYearEndDeclaration, (write) =>
          prior
            ? repo(write, WorkforceYearEndDeclaration).update(prior.id, values, { expectedVersion: prior.version })
            : repo(write, WorkforceYearEndDeclaration).create({
                ...identity(employee),
                taxYear: input.taxYear,
                ...values,
              }),
        ),
      );
    });
  },
);
export const reviewYearEndDeclarationAction = workflowAction(
  'review_year_end_declaration',
  '年末調整申告の証明資料を確認して受付・差戻し',
  reviewYearEndDeclarationInput,
  [P],
  async (ctx, input) => {
    const initial = await repo(ctx, WorkforceYearEndDeclaration).get(input.declarationId);
    return employeeLock(ctx, initial.employeeId, async () => {
      const row = await repo(ctx, WorkforceYearEndDeclaration).get(initial.id);
      requireOther(ctx, row);
      expectVersion(row.version, input.expectedVersion);
      await assertYearOpen(ctx, row.employeeId, row.taxYear);
      if (row.status !== 'submitted')
        throw new StateError('提出済みの申告を選択してください', '再提出または現在の受付状態を確認してください。');
      return command(
        await internalWrite(ctx, WorkforceYearEndDeclaration, (write) =>
          repo(write, WorkforceYearEndDeclaration).update(
            row.id,
            { status: input.decision === 'accept' ? 'accepted' : 'returned', ...reviewed(ctx, input.reason) },
            { expectedVersion: row.version },
          ),
        ),
      );
    });
  },
  false,
);
export const calculateYearEndAction = workflowAction(
  'calculate_year_end_adjustment',
  '受付済み申告と確定給与から年末調整額を計算',
  calculateYearEndInput,
  [P],
  (ctx, input) =>
    withLock(ctx, 'workforce:policies', () =>
      employeeLock(ctx, input.employeeId, async () => {
        if (input.adjustedOn > jstDate(ctx.now()))
          throw new StateError(
            '将来日の年末調整は計算できません',
            '適用日以降に年間給与と本人申告を確認して計算してください。',
          );
        await assertYearOpen(ctx, input.employeeId, input.taxYear);
        const existing = await allRows(ctx, WorkforceYearEndAdjustment, {
          employeeId: input.employeeId,
          taxYear: input.taxYear,
          docstatus: 0,
        });
        if (existing.length > 1)
          throw new StateError('年末調整下書きが重複しています', '給与本部で下書きの状態を確認してください。');
        const prior = existing[0];
        expectVersion(prior?.version ?? 0, input.expectedVersion);
        const source = await yearEndSource(ctx, input.employeeId, input.taxYear, input.adjustedOn),
          value = source.result;
        const values = {
          declarationId: source.declaration.id,
          adjustedOn: input.adjustedOn,
          taxablePay: value.taxablePay,
          annualTax: value.annualTax,
          withheldTax: value.withheldTax,
          refund: value.refund,
          additionalTax: value.additionalTax,
          calculation: source.calculation,
          sourceFingerprint: source.fingerprint,
          reviewedBy: null,
          reviewedAt: null,
          reviewReason: null,
        };
        return command(
          await internalWrite(ctx, WorkforceYearEndAdjustment, (write) =>
            prior
              ? repo(write, WorkforceYearEndAdjustment).update(prior.id, values, { expectedVersion: prior.version })
              : repo(write, WorkforceYearEndAdjustment).create({
                  ...identity(source.employee),
                  taxYear: input.taxYear,
                  ...values,
                }),
          ),
        );
      }),
    ),
  false,
);
export const confirmYearEndAction = workflowAction(
  'confirm_year_end_adjustment',
  '算定根拠を再確認して年末調整を確定',
  confirmYearEndInput,
  [P],
  async (ctx, input) => {
    const initial = await repo(ctx, WorkforceYearEndAdjustment).get(input.adjustmentId);
    return withLock(ctx, 'workforce:policies', () =>
      employeeLock(ctx, initial.employeeId, async () => {
        const row = await repo(ctx, WorkforceYearEndAdjustment).lock(initial.id);
        requireOther(ctx, row);
        expectVersion(row.version, input.expectedVersion);
        if (row.docstatus !== 0)
          throw new StateError('年末調整は下書きではありません', '現在の状態を再読込してください。');
        await assertYearOpen(ctx, row.employeeId, row.taxYear);
        const source = await yearEndSource(
          ctx,
          row.employeeId,
          row.taxYear,
          row.adjustedOn,
          yearEndSnapshotSchema(row.calculation),
        );
        if (
          source.fingerprint !== row.sourceFingerprint ||
          stableJson(source.calculation) !== stableJson(row.calculation) ||
          !source.result.taxablePay.eq(row.taxablePay) ||
          !source.result.annualTax.eq(row.annualTax) ||
          !source.result.withheldTax.eq(row.withheldTax) ||
          !source.result.refund.eq(row.refund) ||
          !source.result.additionalTax.eq(row.additionalTax)
        )
          throw new StateError(
            '年末調整の元資料または保存された算定結果が変更されています',
            '本人申告・給与・証跡を再確認し、再計算してください。',
          );
        return internalWrite(ctx, WorkforceYearEndAdjustment, async (write) => {
          const updated = await repo(write, WorkforceYearEndAdjustment).update(row.id, reviewed(ctx, input.reason), {
            expectedVersion: row.version,
          });
          return command(
            await submitDocument(write, WorkforceYearEndAdjustment, row.id, { expectedVersion: updated.version }),
          );
        });
      }),
    );
  },
  false,
);
export const cancelYearEndAction = workflowAction(
  'cancel_year_end_adjustment',
  '未精算の確定年末調整を理由付きで取消',
  cancelYearEndInput,
  [P],
  async (ctx, input) => {
    const initial = await repo(ctx, WorkforceYearEndAdjustment).get(input.adjustmentId);
    return employeeLock(ctx, initial.employeeId, async () => {
      const row = await repo(ctx, WorkforceYearEndAdjustment).lock(initial.id);
      requireOther(ctx, row);
      expectVersion(row.version, input.expectedVersion);
      if (row.docstatus !== 1 || row.settledOn)
        throw new StateError(
          '未精算の確定年末調整だけを取り消せます',
          '精算済みの返金・追加徴収は実支払と整合した別途訂正手続きが必要です。',
        );
      return internalWrite(ctx, WorkforceYearEndAdjustment, async (write) => {
        const updated = await repo(write, WorkforceYearEndAdjustment).update(row.id, reviewed(ctx, input.reason), {
          expectedVersion: row.version,
        });
        return command(
          await cancelDocument(write, WorkforceYearEndAdjustment, row.id, { expectedVersion: updated.version }),
        );
      });
    });
  },
  false,
);
export const settleYearEndAction = workflowAction(
  'settle_year_end_adjustment',
  '年末調整の返金・追加徴収の実精算を記録',
  settleYearEndInput,
  [P],
  async (ctx, input) => {
    const initial = await repo(ctx, WorkforceYearEndAdjustment).get(input.adjustmentId);
    return employeeLock(ctx, initial.employeeId, async () => {
      const row = await repo(ctx, WorkforceYearEndAdjustment).lock(initial.id);
      requireOther(ctx, row);
      expectVersion(row.version, input.expectedVersion);
      if (
        row.docstatus !== 1 ||
        row.settledOn ||
        input.settledOn < row.adjustedOn ||
        input.settledOn > jstDate(ctx.now())
      )
        throw new StateError(
          '年末調整の精算日または状態が不正です',
          '未精算の確定結果に、調整日以降・本日以前の実精算日を記録してください。',
        );
      return command(
        await internalWrite(ctx, WorkforceYearEndAdjustment, (write) =>
          repo(write, WorkforceYearEndAdjustment).update(
            row.id,
            { settledOn: input.settledOn, settlementReference: input.reference },
            { expectedVersion: row.version },
          ),
        ),
      );
    });
  },
  false,
);
