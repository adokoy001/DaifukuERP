import type { FiscalBoard, MyFiscal, PayrollConditionInput, StatutoryPayrollInput, YearEndDeclaration } from '@daifuku/mod-workforce/fiscal-contract';
import type { WorkSystemBoard, WorkSystemInput } from '@daifuku/mod-workforce/work-system-contract';
import { useWorkforceRead } from './workforce-query.ts';
export type { FiscalBoard, MyFiscal, PayrollConditionInput, StatutoryPayrollInput, YearEndDeclaration, WorkSystemBoard, WorkSystemInput };
export const useFiscalBoard = (enabled: boolean) => useWorkforceRead<FiscalBoard>('workforce.fiscal_board', { taxYear: 2026 }, enabled);
export const useMyFiscal = (enabled: boolean) => useWorkforceRead<MyFiscal>('workforce.my_fiscal_portal', { taxYear: 2026 }, enabled);
export const useWorkSystemBoard = (period: string, enabled: boolean) => useWorkforceRead<WorkSystemBoard>('workforce.work_system_board', { period }, enabled);
