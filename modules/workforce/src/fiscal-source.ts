import { repo, StateError, type Context, type Infer } from '@daifuku/kernel';
import { type WorkforcePayroll, WorkforcePayrollCondition, WorkforceYearEndAdjustment } from './entities/index.ts';
import { allRows, D } from './common.ts';
import { payrollConditionData, statutoryPayrollInput, type StatutoryPayrollInput } from './fiscal-contract.ts';
import { addDays, periodBounds } from './services/time.ts';
import { resolveMonthlyRules } from './payroll-rules/resolver.ts';
export async function conditionOn(ctx: Context, employeeId: string, date: string) {
  const rows = await allRows(ctx, WorkforcePayrollCondition, {
    employeeId,
    validFrom: { $lte: date },
    validTo: { $gte: date },
  });
  const row = rows[0];
  if (rows.length !== 1 || !row)
    throw new StateError(
      `税・保険の本人条件が ${date} に一意に適用できません`,
      '給与本部で適用期間、加入・免除、標準報酬、扶養数、住民税通知を確認してください。',
    );
  return { row, facts: payrollConditionData.parse(row.condition) };
}
export async function assertYearOpen(ctx: Context, employeeId: string, year: number): Promise<void> {
  if (await repo(ctx, WorkforceYearEndAdjustment).count({ employeeId, taxYear: year, docstatus: 1 }))
    throw new StateError(
      'この年の年末調整は確定済みです',
      '精算状態を確認し、年末調整を取り消してから元資料を変更してください。',
    );
}
export async function statutorySource(
  ctx: Context,
  input: StatutoryPayrollInput,
  payroll: Infer<typeof WorkforcePayroll>,
  snapshotSchema: 1 | 2 = 2,
) {
  const bounds = periodBounds(input.period);
  if (input.paymentDate < bounds.end || input.paymentDate.slice(0, 7) > addDays(bounds.end, 1).slice(0, 7))
    throw new StateError(
      '給与の支払日が対応範囲外です',
      '完了した給与月の末日以降で、導入済み制度の対応期間内の通常給与支払日を指定してください。',
    );
  if (
    input.insurancePeriod > input.paymentDate.slice(0, 7) ||
    input.insurancePeriod < addDays(periodBounds(input.paymentDate.slice(0, 7)).start, -1).slice(0, 7)
  )
    throw new StateError(
      '保険対象月が通常の控除範囲外です',
      '支払月またはその前月を指定してください。遡及・複数月分控除はこの自動計算の対象外です。',
    );
  const selected = await resolveMonthlyRules(ctx, {
    paymentDate: input.paymentDate,
    insurancePeriod: input.insurancePeriod,
    wagePeriod: input.period,
  });
  if (snapshotSchema === 1 && !selected.legacyCompatible)
    throw new StateError(
      '旧形式給与の制度版が変更されています',
      '現在の制度と元資料を確認して給与を再計算してください。',
    );
  const rules = selected.row,
    tax = await conditionOn(ctx, input.employeeId, input.paymentDate),
    insurance = await conditionOn(ctx, input.employeeId, periodBounds(input.insurancePeriod).end),
    employment = await conditionOn(ctx, input.employeeId, bounds.end);
  const taxablePay = payroll.basePay
    .plus(payroll.premiumPay)
    .plus(input.taxableAllowances.reduce((sum, row) => sum.plus(row.amount), D(0)));
  const grossPay = taxablePay.plus(input.nonTaxableAllowances.reduce((sum, row) => sum.plus(row.amount), D(0)));
  const social = selected.provider.insurance(
    selected.bundle,
    {
      ...insurance.facts,
      employmentMembership: employment.facts.employmentMembership,
      employmentCategory: employment.facts.employmentCategory,
    },
    input.insurancePeriod,
    bounds.end,
    grossPay,
  );
  const withholding = selected.provider.monthly(
    selected.bundle,
    taxablePay,
    social.total,
    tax.facts.sourceDependentCount,
  );
  const basis = `${rules.code} / 支払 ${input.paymentDate} / 保険 ${input.insurancePeriod} / 賃金締切 ${bounds.end}`;
  const amounts = {
    income_tax: withholding.incomeTax,
    resident_tax: D(tax.facts.residentTaxAmount),
    health_insurance: social.health,
    nursing_insurance: social.nursing,
    pension: social.pension,
    employment_insurance: social.employment,
    child_support: social.childSupport,
    other: D(input.otherDeduction.amount),
  };
  const deductions = Object.entries(amounts).map(([kind, amount]) => ({
    kind,
    amount: amount.toString(),
    basis: kind === 'other' ? input.otherDeduction.basis : kind === 'resident_tax' ? tax.facts.residentTaxBasis : basis,
    confirmed: true as const,
  }));
  const allowances = [...input.taxableAllowances, ...input.nonTaxableAllowances];
  if (allowances.length > 30)
    throw new StateError('手当の合計件数が上限を超えます', '課税・非課税を合わせて30件以内に整理してください。');
  const deductionTotal = Object.values(amounts).reduce((sum, value) => sum.plus(value), D(0)),
    netPay = grossPay.minus(deductionTotal);
  if (netPay.lt(0))
    throw new StateError(
      '自動計算した控除額が支給額を超えます',
      '加入条件と住民税通知を確認してください。不足額の別徴収はこの給与では確定できません。',
    );
  const evidence = {
    rule: { id: rules.id, version: rules.version, data: rules.data, sources: rules.sources },
    taxCondition: tax.row,
    insuranceCondition: insurance.row,
    employmentCondition: employment.row,
    input,
    taxablePay,
    social,
    withholding,
    deductions,
    allowances,
    ...(snapshotSchema === 2 ? { ruleSelection: selected.selection } : {}),
  };
  return { grossPay, deductionTotal, netPay, deductions, allowances, evidence, snapshotSchema };
}
export function statutoryEnvelope(calculation: unknown): {
  input: StatutoryPayrollInput;
  evidence: unknown;
  snapshotSchema: 1 | 2;
} | null {
  if (!calculation || typeof calculation !== 'object' || !('statutory' in calculation)) return null;
  const statutory = calculation.statutory;
  if (!statutory || typeof statutory !== 'object' || !('input' in statutory) || !('evidence' in statutory))
    throw new StateError('自動給与の算定根拠が不正です', '給与を再計算してください。');
  const schema = 'snapshotSchema' in statutory ? statutory.snapshotSchema : 1;
  if (schema !== 1 && schema !== 2)
    throw new StateError('自動給与の証跡形式に対応していません', '対応する版のアプリで確認してください。');
  if (schema === 1 && 'snapshotSchema' in statutory)
    throw new StateError('旧形式給与の証跡が不正です', '保存済み根拠を確認し、給与を再計算してください。');
  return { input: statutoryPayrollInput.parse(statutory.input), evidence: statutory.evidence, snapshotSchema: schema };
}
