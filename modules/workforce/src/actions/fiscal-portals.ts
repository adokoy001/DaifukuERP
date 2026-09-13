import { defineAction, label, repo, type Infer } from '@daifuku/kernel';
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
    const [employees, rules, conditions, declarations, adjustments, evidence] = await Promise.all([
      allRows(ctx, WorkforceEmployee),
      allRows(ctx, WorkforcePayrollRules, { taxYear: input.taxYear }),
      allRows(ctx, WorkforcePayrollCondition),
      allRows(ctx, WorkforceYearEndDeclaration, { taxYear: input.taxYear }),
      allRows(ctx, WorkforceYearEndAdjustment, { taxYear: input.taxYear }),
      allRows(ctx, WorkforcePayrollTaxEvidence, {
        paymentDate: { $gte: `${input.taxYear}-01-01`, $lte: `${input.taxYear + 1}-01-31` },
      }),
    ]);
    return fiscalBoardOutput.parse({
      taxYear: input.taxYear,
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
    if (!self) return { taxYear: input.taxYear, employeeId: null, declaration: null, adjustments: [] };
    const declarations = await allRows(ctx, WorkforceYearEndDeclaration, {
        employeeId: self.id,
        taxYear: input.taxYear,
      }),
      adjustments = await allRows(ctx, WorkforceYearEndAdjustment, {
        employeeId: self.id,
        taxYear: input.taxYear,
        docstatus: 1,
      });
    return myFiscalOutput.parse({
      taxYear: input.taxYear,
      employeeId: self.id,
      declaration: declarations[0] ? declaration(declarations[0]) : null,
      adjustments: adjustments.map(adjustment),
    });
  },
});
