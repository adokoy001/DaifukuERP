import { repo, StateError, type Context } from '@daifuku/kernel';
import { WorkforceEmployee, WorkforcePayroll, WorkforcePayrollTaxEvidence, WorkforceYearEndDeclaration } from './entities/index.ts';
import { allRows, D } from './common.ts';
import { yearEndDeclarationData } from './fiscal-contract.ts';
import { fiscalRules } from './fiscal-source.ts';
import { annualAdjustment } from './services/annual-tax.ts';
import { ANNUAL_TAX_2026 } from './services/fiscal-data.ts';
import { stableJson } from './services/json.ts';
export async function yearEndSource(ctx: Context, employeeId: string, adjustedOn: string) {
  if (adjustedOn < ANNUAL_TAX_2026.applicableFrom || adjustedOn > ANNUAL_TAX_2026.regularAdjustmentThrough) throw new StateError('2026年末調整の適用日が範囲外です', '2026年12月から翌年1月の通常の年末調整・再調整を指定してください。');
  const employee = await repo(ctx, WorkforceEmployee).get(employeeId), rules = await fiscalRules(ctx);
  const declarations = await allRows(ctx, WorkforceYearEndDeclaration, { employeeId, taxYear: 2026 }), declaration = declarations[0];
  if (declarations.length !== 1 || !declaration || declaration.status !== 'accepted') throw new StateError('本人申告が受付済みではありません', '本人が申告し、給与本部が証明資料・適用条件を確認して受付してください。');
  const facts = yearEndDeclarationData.parse(declaration.declaration);
  const payrolls = await allRows(ctx, WorkforcePayroll, { employeeId, period: { $gte: '2025-12', $lte: '2026-12' }, docstatus: { $in: [0, 1] } });
  const allEvidence = await allRows(ctx, WorkforcePayrollTaxEvidence, { employeeId, payrollId: { $in: payrolls.map((row) => row.id) } });
  const evidence = allEvidence.filter((row) => row.paymentDate >= '2026-01-01' && row.paymentDate <= '2026-12-31' && payrolls.some((payroll) => payroll.id === row.payrollId && payroll.docstatus === 1));
  if (payrolls.some((row) => row.docstatus === 0 && row.period.startsWith('2026-'))) throw new StateError('年内の給与下書きが残っています', '確定または取り消しを整理し、年間給与の完了を確認してください。');
  if (payrolls.some((row) => row.docstatus === 1 && !allEvidence.some((item) => item.payrollId === row.id))) throw new StateError('確定給与の支払日・課税支給額の証跡が不足しています', '既存給与には原資料から支払証跡を登録してください。翌年支払の給与も支払年を判別できる証跡が必要です。');
  if (evidence.some((row) => row.paymentDate > adjustedOn)) throw new StateError('調整日後の給与支払が含まれています', '最後の年内支払日以降に年末調整を実施してください。');
  if (!evidence.some((row) => row.paymentDate >= '2026-12-01')) throw new StateError('通常の12月年末調整に必要な給与支払がありません', '死亡・非居住者・年途中退職等の例外年調はこの版の対象外です。');
  const unpaid = new Set(facts.unpaidMonths.map((row) => row.period));
  if (unpaid.size !== facts.unpaidMonths.length || [...unpaid].some((month) => !month.startsWith('2026-'))) throw new StateError('無支払月の申告が不正です', '2026年の各無支払月を理由付きで一度ずつ記録してください。');
  for (let month = 1; month <= 12; month++) {
    const key = `2026-${String(month).padStart(2, '0')}`;
    if (key < employee.hiredOn.slice(0, 7) || (employee.terminatedOn && key > employee.terminatedOn.slice(0, 7))) continue;
    const hasPay = evidence.some((row) => row.paymentDate.startsWith(key));
    if ((!hasPay && !unpaid.has(key)) || (hasPay && unpaid.has(key))) throw new StateError(`${key} の支払実績と無支払申告が一致しません`, '支払証跡または理由付き無支払月を本人申告に揃え、再受付してください。');
  }
  const previousPay = facts.previousEmployers.reduce((sum, row) => sum.plus(row.taxablePay), D(0)), previousSocial = facts.previousEmployers.reduce((sum, row) => sum.plus(row.socialPremium), D(0)), previousTax = facts.previousEmployers.reduce((sum, row) => sum.plus(row.incomeTax), D(0));
  const taxablePay = evidence.reduce((sum, row) => sum.plus(row.taxablePay), previousPay), socialPremium = evidence.reduce((sum, row) => sum.plus(row.socialPremium), previousSocial), withheldTax = evidence.reduce((sum, row) => sum.plus(row.incomeTax), previousTax);
  const result = annualAdjustment(facts, taxablePay, socialPremium, withheldTax);
  const snapshot = { employee, rules, declaration, payrolls: payrolls.filter((row) => evidence.some((item) => item.payrollId === row.id)).sort((a, b) => a.id.localeCompare(b.id)), evidence: evidence.sort((a, b) => a.id.localeCompare(b.id)), adjustedOn };
  return { employee, declaration, result, fingerprint: stableJson(snapshot), calculation: { ...result, source: snapshot } };
}
