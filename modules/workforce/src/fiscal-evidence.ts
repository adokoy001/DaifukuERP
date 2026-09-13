import { repo, StateError, type Context } from '@daifuku/kernel';
import { z } from 'zod';
import type { payrollTaxEvidenceInput } from './fiscal-contract.ts';
import { WorkforcePayrollTaxEvidence } from './entities/index.ts';
import { D } from './common.ts';
import { internalWrite } from './internal.ts';
import { assertYearOpen } from './fiscal-source.ts';
const socialKinds = new Set([
  'health_insurance',
  'nursing_insurance',
  'pension',
  'employment_insurance',
  'child_support',
]);
export async function createTaxEvidence(
  ctx: Context,
  row: { id: string; employeeId: string; userId: string; siteId: string; deductions: unknown },
  input: z.infer<typeof payrollTaxEvidenceInput>,
) {
  await assertYearOpen(ctx, row.employeeId, Number(input.paymentDate.slice(0, 4)));
  if (await repo(ctx, WorkforcePayrollTaxEvidence).count({ payrollId: row.id }))
    throw new StateError(
      '給与の支払証跡は登録済みです',
      '登録済みの証跡を確認してください。変更は元給与を取り消して再確定する必要があります。',
    );
  const deductions = z.array(z.object({ kind: z.string(), amount: z.string() })).parse(row.deductions);
  const socialPremium = deductions
    .filter((item) => socialKinds.has(item.kind))
    .reduce((sum, item) => sum.plus(item.amount), D(0));
  const tax = deductions.find((item) => item.kind === 'income_tax');
  if (!tax || deductions.filter((item) => socialKinds.has(item.kind)).length !== socialKinds.size)
    throw new StateError(
      '確定給与の控除証跡が不足しています',
      '元給与の八つの控除項目を確認してください。欠けた控除をゼロとは推定しません。',
    );
  const incomeTax = D(tax.amount);
  return internalWrite(ctx, WorkforcePayrollTaxEvidence, (write) =>
    repo(write, WorkforcePayrollTaxEvidence).create({
      employeeId: row.employeeId,
      userId: row.userId,
      siteId: row.siteId,
      payrollId: row.id,
      paymentDate: input.paymentDate,
      taxablePay: D(input.taxablePay),
      socialPremium,
      incomeTax,
      basis: input.basis,
    }),
  );
}
