import type {
  FiscalBoard,
  MyFiscal,
  PayrollConditionInput,
  StatutoryPayrollInput,
  YearEndDeclaration,
} from '@daifuku/mod-workforce/fiscal-contract';
import type { WorkSystemBoard, WorkSystemInput } from '@daifuku/mod-workforce/work-system-contract';
import type {
  PayrollRuleCatalog,
  PayrollRulePreview,
  PayrollRuleSummary,
} from '@daifuku/mod-workforce/payroll-rules-contract';
import { useWorkforceRead } from './workforce-query.ts';
export type {
  FiscalBoard,
  MyFiscal,
  PayrollConditionInput,
  StatutoryPayrollInput,
  YearEndDeclaration,
  WorkSystemBoard,
  WorkSystemInput,
  PayrollRuleCatalog,
  PayrollRulePreview,
  PayrollRuleSummary,
};
export const useFiscalBoard = (enabled: boolean, taxYear?: number) =>
  useWorkforceRead<FiscalBoard>('workforce.fiscal_board', taxYear === undefined ? {} : { taxYear }, enabled);
export const useMyFiscal = (enabled: boolean, taxYear?: number) =>
  useWorkforceRead<MyFiscal>('workforce.my_fiscal_portal', taxYear === undefined ? {} : { taxYear }, enabled);
export const usePayrollRuleCatalog = (enabled: boolean) =>
  useWorkforceRead<PayrollRuleCatalog>('workforce.payroll_rule_catalog', {}, enabled);
export const usePayrollRulePreview = (packageCode: string, enabled: boolean) =>
  useWorkforceRead<PayrollRulePreview>('workforce.preview_payroll_rule', { packageCode }, enabled);
export const useWorkSystemBoard = (period: string, enabled: boolean) =>
  useWorkforceRead<WorkSystemBoard>('workforce.work_system_board', { period }, enabled);
