import {
  Conflict,
  Decimal,
  PermissionDenied,
  StateError,
  repo,
  withLock,
  type Context,
  type Domain,
  type EntityDef,
  type Infer,
  type ListQuery,
} from '@daifuku/kernel';
import { WorkforceEmployee, WorkforcePayPolicy, WorkforceSite } from './entities/index.ts';
import { jstDate } from './services/time.ts';
import { stableJson } from './services/json.ts';
export const userId = (ctx: Context): string =>
  ctx.actor.type === 'agent' ? (ctx.actor.onBehalfOf ?? '') : ctx.actor.id;
export const D = Decimal.from;
export function expectVersion(actual: number, expected: number): void {
  if (actual !== expected)
    throw new Conflict('Workforce record changed concurrently', 'Reload the current record before retrying.');
}
export function requireRole(ctx: Context, roles: readonly string[]): void {
  if (!ctx.roles.includes('admin') && !roles.some((role) => ctx.roles.includes(role)))
    throw new PermissionDenied('workforce', 'workflow', ctx.roles);
}
export function requireSelf(ctx: Context, employee: { userId: string }): void {
  if (employee.userId !== userId(ctx)) throw new PermissionDenied('workforce', 'self-service', ctx.roles);
}
export function requireOther(ctx: Context, row: { userId: string }): void {
  if (row.userId === userId(ctx)) throw new PermissionDenied('workforce', 'self-approval', ctx.roles);
}
export function employeeLock<T>(ctx: Context, employeeId: string, work: () => Promise<T>): Promise<T> {
  return withLock(ctx, `workforce:employee:${employeeId}`, work);
}
export async function allRows<E extends EntityDef>(
  ctx: Context,
  entity: E,
  where: Domain = {},
  orderBy?: ListQuery['orderBy'],
): Promise<Infer<E>[]> {
  const rows: Infer<E>[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await repo(ctx, entity).list({ where, ...(orderBy ? { orderBy } : {}), limit: 500, offset });
    rows.push(...page.items);
    if (rows.length >= page.total || !page.items.length) return rows;
    if (rows.length >= 20000)
      throw new StateError(
        'Workforce query exceeds the bounded snapshot size',
        'Narrow the reporting period or employee selection.',
      );
  }
}
export async function selfEmployee(ctx: Context) {
  const rows = await repo(ctx, WorkforceEmployee).list({ where: { userId: userId(ctx) }, limit: 2 });
  if (rows.items.length !== 1)
    throw new StateError(
      'Employee profile is not configured',
      'Ask HR to link your company user to an employee and site.',
    );
  return rows.items[0] as Infer<typeof WorkforceEmployee>;
}
export async function activeEmployee(ctx: Context, id: string, date = jstDate(ctx.now())) {
  const employee = await repo(ctx, WorkforceEmployee).get(id);
  if (!employee.active || date < employee.hiredOn || (employee.terminatedOn && date > employee.terminatedOn))
    throw new StateError('Employee is not active on this date', 'Check employment dates and account status.');
  if (!(await repo(ctx, WorkforceSite).get(employee.siteId)).active)
    throw new StateError('Work site is inactive', 'Ask HR to update the employee assignment.');
  return employee;
}
export function identity(employee: Infer<typeof WorkforceEmployee>) {
  return { employeeId: employee.id, userId: employee.userId, siteId: employee.siteId };
}
export function command(row: { id: string; version: number; status?: string; docstatus?: number }) {
  return {
    id: row.id,
    version: row.version,
    status: row.status ?? (row.docstatus === 1 ? 'confirmed' : row.docstatus === 2 ? 'cancelled' : 'draft'),
  };
}
export function reviewed(ctx: Context, reason: string) {
  return { reviewedBy: userId(ctx), reviewedAt: ctx.now(), reviewReason: reason };
}
export async function policyOn(ctx: Context, date: string) {
  const rows = await repo(ctx, WorkforcePayPolicy).list({
    where: { validFrom: { $lte: date }, validTo: { $gte: date } },
    limit: 2,
  });
  if (rows.items.length !== 1)
    throw new StateError(
      'No unambiguous workforce policy applies',
      'HR must configure one effective ordinary working-time policy for this date.',
    );
  return rows.items[0] as Infer<typeof WorkforcePayPolicy>;
}
export async function assertPayrollOpen(ctx: Context, employeeId: string, date: string): Promise<void> {
  // Employee reads only their confirmed payslips; managers have no payroll access. The kernel lock guard below
  // is installed as a shared immutable period boundary, so no payroll amount needs to be disclosed here.
  const { assertWorkforcePeriodOpen } = await import('./period-lock.ts');
  await assertWorkforcePeriodOpen(ctx, employeeId, date);
}
export async function replay<E extends EntityDef>(
  ctx: Context,
  entity: E,
  key: string,
  input: unknown,
): Promise<Infer<E> | null> {
  const rows = await repo(ctx, entity).list({ where: { idempotencyKey: key }, limit: 1 });
  const found = rows.items[0];
  if (!found) return null;
  if (stableJson((found as Record<string, unknown>).requestSnapshot) !== stableJson(input))
    throw new Conflict('Idempotency key was already used with different input', 'Use a new key for a new operation.');
  return found;
}
