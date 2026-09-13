import { defineAction, label, repo, type Context, type Infer } from '@daifuku/kernel';
import {
  fiscalBoardInput,
  fiscalBoardOutput,
  myFiscalOutput,
  payrollConditionData,
  yearEndDeclarationData,
} from '../fiscal-contract.ts';
import {
  WorkforceEmployee,
  WorkforcePayrollCondition,
  WorkforcePayrollRules,
  WorkforcePayrollTaxEvidence,
  WorkforceYearEndAdjustment,
  WorkforceYearEndDeclaration,
} from '../entities/index.ts';
import { E, H, M, P } from '../entities/common.ts';
import { allRows, userId } from '../common.ts';
import { supportedPayrollTaxYears } from '../payroll-rules/resolver.ts';
import { jstDate } from '../services/time.ts';
function declaration(row: Infer<typeof WorkforceYearEndDeclaration>) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    taxYear: row.taxYear,
    status: row.status,
    declaration: yearEndDeclarationData.parse(row.declaration),
    reviewReason: row.reviewReason,
    version: row.version,
  };
}
function adjustment(row: Infer<typeof WorkforceYearEndAdjustment>) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    taxYear: row.taxYear,
    status: row.docstatus === 1 ? 'confirmed' : row.docstatus === 2 ? 'cancelled' : 'draft',
    adjustedOn: row.adjustedOn,
    taxablePay: row.taxablePay.toString(),
    annualTax: row.annualTax.toString(),
    withheldTax: row.withheldTax.toString(),
    refund: row.refund.toString(),
    additionalTax: row.additionalTax.toString(),
    calculation: row.calculation,
    settledOn: row.settledOn,
    settlementReference: row.settlementReference,
    version: row.version,
  };
}
async function fiscalYears(ctx: Context, requestedYear?: number, employeeId?: string) {
  const where = employeeId ? { employeeId } : {};
  const [supportedTaxYears, declarations, adjustments, payments] = await Promise.all([
    supportedPayrollTaxYears(ctx),
    repo(ctx, WorkforceYearEndDeclaration).aggregate({
      where,
      groupBy: ['taxYear'],
      metrics: { rows: { count: true } },
    }),
    repo(ctx, WorkforceYearEndAdjustment).aggregate({
      where: { ...where, ...(employeeId ? { docstatus: 1 } : {}) },
      groupBy: ['taxYear'],
      metrics: { rows: { count: true } },
    }),
    employeeId
      ? Promise.resolve([])
      : repo(ctx, WorkforcePayrollTaxEvidence).aggregate({
          groupBy: ['paymentDate'],
          metrics: { rows: { count: true } },
        }),
  ]);
  const availableTaxYears = [
    ...new Set([
      ...supportedTaxYears,
      ...declarations.map((row) => Number(row.taxYear)),
      ...adjustments.map((row) => Number(row.taxYear)),
      ...payments.map((row) => Number(String(row.paymentDate).slice(0, 4))),
    ]),
  ].sort((a, b) => a - b);
  const currentYear = Number(jstDate(ctx.now()).slice(0, 4));
  const taxYear =
    requestedYear ??
    (supportedTaxYears.includes(currentYear)
      ? currentYear
      : (supportedTaxYears.at(-1) ?? availableTaxYears.at(-1) ?? currentYear));
  return { taxYear, supportedTaxYears, availableTaxYears };
}
export const fiscalBoardAction = defineAction({
  name: 'workforce.fiscal_board',
  description: label('税・保険・年末調整の給与本部管理', 'Payroll fiscal administration'),
  input: fiscalBoardInput,
  output: fiscalBoardOutput,
  permission: { roles: [P] },
  siteAccess: false,
  tx: 'none',
  mutates: false,
  async handler(ctx, input) {
    const years = await fiscalYears(ctx, input.taxYear);
    const [employees, rules, conditions, declarations, adjustments, evidence] = await Promise.all([
      allRows(ctx, WorkforceEmployee),
      allRows(ctx, WorkforcePayrollRules, { taxYear: years.taxYear }),
      allRows(ctx, WorkforcePayrollCondition),
      allRows(ctx, WorkforceYearEndDeclaration, { taxYear: years.taxYear }),
      allRows(ctx, WorkforceYearEndAdjustment, { taxYear: years.taxYear }),
      allRows(ctx, WorkforcePayrollTaxEvidence, {
        paymentDate: { $gte: `${years.taxYear}-01-01`, $lte: `${years.taxYear + 1}-01-31` },
      }),
    ]);
    return fiscalBoardOutput.parse({
      ...years,
      employees: employees.map(({ id, name, code, siteId }) => ({ id, name, code, siteId })),
      rules: rules.map(({ id, code, taxYear, sources }) => ({ id, code, taxYear, sources })),
      conditions: conditions.map((row) => ({
        ...payrollConditionData.parse(row.condition),
        id: row.id,
        employeeId: row.employeeId,
        version: row.version,
      })),
      declarations: declarations.map(declaration),
      adjustments: adjustments.map(adjustment),
      taxEvidence: evidence.map((row) => ({
        id: row.id,
        payrollId: row.payrollId,
        paymentDate: row.paymentDate,
        taxablePay: row.taxablePay.toString(),
        socialPremium: row.socialPremium.toString(),
        incomeTax: row.incomeTax.toString(),
        basis: row.basis,
      })),
    });
  },
});
export const myFiscalAction = defineAction({
  name: 'workforce.my_fiscal_portal',
  description: label('自分の年末調整申告と確定結果', 'My year-end declaration and confirmed result'),
  input: fiscalBoardInput,
  output: myFiscalOutput,
  permission: { roles: [E, M, H, P] },
  siteAccess: true,
  tx: 'none',
  mutates: false,
  async handler(ctx, input) {
    const self = (await repo(ctx, WorkforceEmployee).list({ where: { userId: userId(ctx) }, limit: 1 })).items[0];
    if (!self) {
      const currentYear = Number(jstDate(ctx.now()).slice(0, 4));
      return {
        taxYear: input.taxYear ?? currentYear,
        supportedTaxYears: [],
        availableTaxYears: [],
        employeeId: null,
        declaration: null,
        adjustments: [],
      };
    }
    const years = await fiscalYears(ctx, input.taxYear, self.id);
    const declarations = await allRows(ctx, WorkforceYearEndDeclaration, {
        employeeId: self.id,
        taxYear: years.taxYear,
      }),
      adjustments = await allRows(ctx, WorkforceYearEndAdjustment, {
        employeeId: self.id,
        taxYear: years.taxYear,
        docstatus: 1,
      });
    return myFiscalOutput.parse({
      ...years,
      employeeId: self.id,
      declaration: declarations[0] ? declaration(declarations[0]) : null,
      adjustments: adjustments.map(adjustment),
    });
  },
});
