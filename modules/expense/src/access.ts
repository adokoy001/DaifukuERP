// Role rules of the expense module (spec AC-15, D8, D26). Entity and action permissions grant `accounting`; these checks
// add the second role a settlement needs (`workforce_payroll`, because submit also settles workforce expenses) and the
// self-settlement refusal. Both are PERMISSION_DENIED with the reason in `details.op`, raised before anything is read
// or written. Settling is a decision of a person: an API key (machine actor) is refused first with `human-actor-required`
// through the kernel port (docs/specs/machine-credentials.md AC-22), whatever roles the key holds.
import { PermissionDenied, requireHumanUserId, type Context } from '@daifuku/kernel';
import { REQUIRES_PAYROLL_SUFFIX, SELF_SETTLEMENT_SUFFIX } from './contract.ts';

/** The person behind the request (agent → the user it acts for); an API key is refused (machine-credentials AC-22). */
export function actorUserId(ctx: Context): string {
  return requireHumanUserId(ctx);
}

export function canSettle(ctx: Context): boolean {
  return ctx.roles.includes('admin') || (ctx.roles.includes('accounting') && ctx.roles.includes('workforce_payroll'));
}

/**
 * `human-actor-required` for an API key, then `<op>:requires-workforce_payroll` unless the caller is admin or holds
 * both accounting and workforce_payroll. Every caller-facing hook (create, update, line save and delete, delete,
 * submit, cancel; amend goes through create) and the draft / candidates actions call this before they read or write;
 * only module-internal writes (write capability) and allowOnSubmit updates of server-owned fields skip it.
 */
export function requireSettlementRoles(ctx: Context, entity: string, op: string): void {
  requireHumanUserId(ctx);
  if (!canSettle(ctx)) throw new PermissionDenied(entity, `${op}${REQUIRES_PAYROLL_SUFFIX}`, ctx.roles);
}

/** `<op>:self-settlement` when the employee of the record is the caller (admin included). */
export function refuseSelfSettlement(ctx: Context, entity: string, op: string, employeeUserId: unknown): void {
  if (typeof employeeUserId === 'string' && employeeUserId === actorUserId(ctx))
    throw new PermissionDenied(entity, `${op}${SELF_SETTLEMENT_SUFFIX}`, ctx.roles);
}
