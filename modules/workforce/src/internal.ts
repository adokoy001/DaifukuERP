// Module-private authority: exported only between workforce implementation files, never from package index.
import { defineWriteCapability, hasWriteCapability, registry, withWriteCapability, StateError, type Context, type EntityDef } from '@daifuku/kernel';
import * as entities from './entities/index.ts';
const managed: EntityDef[] = [entities.WorkforceEmployee, entities.WorkforceAttendance, entities.WorkforcePunch, entities.WorkforceAttendanceCorrection, entities.WorkforceLeaveGrant, entities.WorkforceLeaveRequest, entities.WorkforceLeaveUsage, entities.WorkforceExpense, entities.WorkforcePayroll, entities.WorkforcePeriodLock, entities.WorkforceShiftProfile, entities.WorkforceShiftAvailability, entities.WorkforceShiftPlan, entities.WorkforceShiftAssignment, entities.WorkforcePayrollRules, entities.WorkforcePayrollCondition, entities.WorkforcePayrollTaxEvidence, entities.WorkforceYearEndDeclaration, entities.WorkforceYearEndAdjustment, entities.WorkforceWorkSystemPeriod];
const capabilities = new Map(managed.map((entity) => [entity.name, defineWriteCapability({ name: `${entity.name}.workflow`, entity: entity.name, fields: entity.fieldNames.filter((field) => entity.config.fields[field]?.opts.serverOwned), operations: ['create', 'update', 'submit', 'cancel', 'workflow'] })]));
export function internalWrite<T>(ctx: Context, entity: EntityDef, work: (ctx: Context) => Promise<T>): Promise<T> {
  const capability = capabilities.get(entity.name);
  if (!capability) throw new Error('Unregistered workforce write capability');
  return withWriteCapability(ctx, capability, work);
}
export function requireWorkflow(ctx: Context, entity: string): void {
  if (!hasWriteCapability(ctx, entity, 'workflow')) throw new StateError('Use the workforce workflow action', 'Generic writes cannot create, approve, settle or finalize workforce transactions.');
}
export function registerWorkflowGuards(): void {
  for (const entity of managed) {
    registry.registerHook(entity.name, 'before_create', (ctx) => requireWorkflow(ctx, entity.name));
    if (entity !== entities.WorkforceEmployee) registry.registerHook(entity.name, 'before_update', (ctx) => requireWorkflow(ctx, entity.name));
    registry.registerHook(entity.name, 'before_delete', () => { throw new StateError('Workforce records cannot be deleted', 'Use a reasoned cancellation or deactivate the employee.'); });
  }
  for (const entity of [entities.WorkforcePunch, entities.WorkforceLeaveGrant, entities.WorkforceLeaveUsage, entities.WorkforcePayrollRules, entities.WorkforcePayrollTaxEvidence]) registry.registerHook(entity.name, 'before_update', () => { throw new StateError('Workforce ledger entries are append-only', 'Create a correcting transaction with its reason.'); });
  registry.registerHook(entities.WorkforcePayroll.name, 'before_submit', (ctx) => requireWorkflow(ctx, entities.WorkforcePayroll.name));
  registry.registerHook(entities.WorkforcePayroll.name, 'before_cancel', (ctx) => requireWorkflow(ctx, entities.WorkforcePayroll.name));
  registry.registerHook(entities.WorkforceYearEndAdjustment.name, 'before_submit', (ctx) => requireWorkflow(ctx, entities.WorkforceYearEndAdjustment.name));
  registry.registerHook(entities.WorkforceYearEndAdjustment.name, 'before_cancel', (ctx) => requireWorkflow(ctx, entities.WorkforceYearEndAdjustment.name));
}
