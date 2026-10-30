export { WorkforceModule } from './module.ts';
export * from './entities/index.ts';
export * from './contract.ts';
export { seedWorkforce } from './seed.ts';
export { renderPayslipHtmlAction, buildPayslipRenderData, PAYSLIP_HTML_OVERRIDE } from './actions/payslip.ts';
export {
  defaultPayslipHtml,
  payMonthLabel,
  hoursMinutes,
  DEDUCTION_LABELS,
  type PayslipRenderData,
  type PayslipHtmlRenderer,
  type DeductionKind,
} from './services/payslip-html.ts';
export * from './shift-contract.ts';
export * from './payroll-rules/port.ts';

export { payloadHash, manifestHash } from './payroll-rules/hash.ts';
export {
  resolveMonthlyRules,
  resolveYearEndRules,
  supportedPayrollTaxYears,
  validatePayrollCondition,
} from './payroll-rules/resolver.ts';
