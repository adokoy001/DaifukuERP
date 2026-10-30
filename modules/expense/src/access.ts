// Role rules of the expense module (spec AC-15, D8, D26). Entity and action permissions grant `accounting`; these checks
// add the second role a settlement needs (`workforce_payroll`, because submit also settles workforce expenses) and the
// self-settlement refusal. Both are PERMISSION_DENIED with the reason in `details.op`, raised before anything is read
// or written.
import { PermissionDenied, type Context } from '@daifuku/kernel';
import { REQUIRES_PAYROLL_SUFFIX, SELF_SETTLEMENT_SUFFIX } from './contract.ts';

export function actorUserId(ctx: Context): string {
  return ctx.actor.type === 'agent' ? (ctx.actor.onBehalfOf ?? '') : ctx.actor.id;
}

export function canSettle(ctx: Context): boolean {
  return ctx.roles.includes('admin') || (ctx.roles.includes('accounting') && ctx.roles.includes('workforce_payroll'));
}

/** `<op>:requires-workforce_payroll` unless the caller is admin or holds both accounting and workforce_payroll. */
export function requireSettlementRoles(ctx: Context, entity: string, op: string): void {
  if (!canSettle(ctx)) throw new PermissionDenied(entity, `${op}${REQUIRES_PAYROLL_SUFFIX}`, ctx.roles);
}

/** `<op>:self-settlement` when the employee of the record is the caller (admin included). */
export function refuseSelfSettlement(ctx: Context, entity: string, op: string, employeeUserId: unknown): void {
  if (typeof employeeUserId === 'string' && employeeUserId === actorUserId(ctx))
    throw new PermissionDenied(entity, `${op}${SELF_SETTLEMENT_SUFFIX}`, ctx.roles);
}
