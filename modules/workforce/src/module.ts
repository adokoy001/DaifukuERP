import { defineModule, label } from '@daifuku/kernel';
import * as entities from './entities/index.ts';
import { registerEmployeeAction } from './actions/employees.ts';
import { punchAction, submitAttendanceAction, reviewAttendanceAction } from './actions/attendance.ts';
import { requestCorrectionAction, reviewCorrectionAction } from './actions/corrections.ts';
import { saveExpenseAction, submitExpenseAction, reviewExpenseAction, settleExpenseAction, cancelExpenseAction } from './actions/expenses.ts';
import { registerWorkflowGuards } from './internal.ts';
import { seedWorkforce } from './seed.ts';
import { grantLeaveAction, requestLeaveAction, reviewLeaveAction, cancelLeaveAction } from './actions/leave.ts';
import { calculatePayrollAction, confirmPayrollAction, cancelPayrollAction } from './actions/payroll.ts';
import { myPortalAction, managementPortalAction, initializePolicyAction } from './actions/portals.ts';
import { saveShiftProfileAction, saveShiftAvailabilityAction } from './actions/shift-people.ts';
import { shiftBoardAction, myShiftsAction } from './actions/shift-portals.ts';
import { saveShiftPlanAction, publishShiftPlanAction, cancelShiftPlanAction } from './actions/shift-plans.ts';
import { registerMasterGuards } from './master-guards.ts';

export const WorkforceModule = defineModule({
  name: 'workforce', label: label('従業員・労務', 'Workforce'), depends: [], entities: Object.values(entities),
  actions: [shiftBoardAction, myShiftsAction, saveShiftProfileAction, saveShiftAvailabilityAction, saveShiftPlanAction, publishShiftPlanAction, cancelShiftPlanAction, registerEmployeeAction, punchAction, submitAttendanceAction, reviewAttendanceAction, requestCorrectionAction, reviewCorrectionAction, saveExpenseAction, submitExpenseAction, reviewExpenseAction, settleExpenseAction, cancelExpenseAction, grantLeaveAction, requestLeaveAction, reviewLeaveAction, cancelLeaveAction, calculatePayrollAction, confirmPayrollAction, cancelPayrollAction, myPortalAction, managementPortalAction, initializePolicyAction],
  hooks: () => { registerWorkflowGuards(); registerMasterGuards(); }, seed: seedWorkforce,
  menus: [
    { label: label('自分の勤怠・申請', 'My work and requests'), route: '/me', order: 80 },
    { label: label('労務の承認・給与', 'Workforce management'), route: '/workforce', order: 81 },
    { label: label('拠点・部署', 'Work sites'), entity: entities.WorkforceSite.name, order: 82 },
    { label: label('従業員名簿', 'Employee directory'), entity: entities.WorkforceEmployee.name, order: 83 },
    { label: label('賃金条件', 'Pay terms'), entity: entities.WorkforcePayTerms.name, order: 84 },
  ],
  roles: { workforce_employee: label('従業員本人', 'Employee'), workforce_manager: label('拠点管理者', 'Site manager'), workforce_hr: label('人事本部', 'HR headquarters'), workforce_payroll: label('給与・精算本部', 'Payroll headquarters') },
});
