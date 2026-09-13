import type { EntityMeta } from '../api/types.ts';
const managed = new Set([
  'workforce_employee',
  'workforce_attendance',
  'workforce_punch',
  'workforce_attendance_correction',
  'workforce_leave_grant',
  'workforce_leave_request',
  'workforce_leave_usage',
  'workforce_expense',
  'workforce_payroll',
  'workforce_period_lock',
  'workforce_receipt',
  'workforce_shift_profile',
  'workforce_shift_availability',
  'workforce_shift_plan',
  'workforce_shift_assignment',
  'workforce_payroll_rules',
  'workforce_payroll_condition',
  'workforce_payroll_tax_evidence',
  'workforce_year_end_declaration',
  'workforce_year_end_adjustment',
  'workforce_work_system_period',
]);
export const isWorkforceManaged = (name: string) => managed.has(name);
/** Permissions alone do not promise generic CRUD: workflow records require their business action. */
export function workforceEntityForUi(entity: EntityMeta): EntityMeta {
  if (!isWorkforceManaged(entity.name)) return entity;
  return {
    ...entity,
    ops: entity.ops.filter(
      (op) => op === 'read' || op === 'export' || (entity.name === 'workforce_employee' && op === 'update'),
    ),
  };
}
