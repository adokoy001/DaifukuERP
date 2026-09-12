// Executes a registered action with permission and validation (ADR-0009).
import type { Context } from '../context.ts';
import type { ActionDef } from '../dsl/action.ts';
import { DaifukuError, PermissionDenied, ValidationError } from '../errors.ts';
import { assertOp } from '../permissions.ts';
import { registry } from '../registry.ts';

export function checkActionPermission(ctx: Context, action: ActionDef): void {
  if (ctx.actor.type === 'relay' && action.relayAccess !== true) throw new PermissionDenied(action.name, 'relay-action', ctx.roles);
  if (ctx.accessScope === 'stores' && !action.generic && action.storeAccess !== true) throw new PermissionDenied(action.name, 'store-action', ctx.roles);
  if (ctx.accessScope === 'sites' && !action.generic && action.siteAccess !== true && !(action.storeAccess === true && ctx.storeIds?.length)) throw new PermissionDenied(action.name, 'site-action', ctx.roles);
  if (registry.hasPack(action.module) && !(ctx.appliedPacks ?? []).includes(action.module)) throw new PermissionDenied(action.name, 'pack-not-applied', ctx.roles);
  const p = action.permission;
  if (p === 'authenticated') return;
  if ('entity' in p) {
    assertOp(ctx, registry.entity(p.entity), p.op);
    return;
  }
  if (ctx.roles.includes('admin') || p.roles.some((r) => ctx.roles.includes(r))) return;
  throw new PermissionDenied(action.name, 'execute', ctx.roles);
}

export function checkActionExport(ctx: Context, action: ActionDef): void {
  checkActionPermission(ctx, action);
  const entities = action.exportEntities ?? (action.generic && action.permission !== 'authenticated' && 'entity' in action.permission ? [action.permission.entity] : []);
  if (action.mutates || !entities.length) throw new PermissionDenied(action.name, 'export', ctx.roles);
  for (const entity of entities) assertOp(ctx, registry.entity(entity), 'export');
}

export function canExportAction(ctx: Context, action: ActionDef): boolean {
  try { checkActionExport(ctx, action); return true; } catch (error) { if (error instanceof PermissionDenied) return false; throw error; }
}

export function canRunAction(ctx: Context, action: ActionDef): boolean {
  try { checkActionPermission(ctx, action); return true; } catch (error) { if (error instanceof PermissionDenied) return false; throw error; }
}

export async function runAction(ctx: Context, name: string, rawInput: unknown): Promise<unknown> {
  const action = registry.hasAction(name) ? registry.action(name) : null;
  if (!action) {
    throw new DaifukuError('NOT_FOUND', `action "${name}" does not exist`, `List available actions with GET /meta or the MCP tool list.`, { action: name }, 404);
  }
  checkActionPermission(ctx, action);
  let input: unknown = rawInput ?? {};
  if (action.inputMode === 'lenient') {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new ValidationError(`invalid input for ${name}`, [{ path: '', message: 'expected an object' }], 'Send a JSON object; see the input schema in the action metadata.');
    }
  } else {
    const parsed = action.input.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
      throw new ValidationError(`invalid input for ${name}`, issues, 'See details.issues; the input schema is in the action metadata.');
    }
    input = parsed.data;
  }
  const result = await action.handler(ctx, input as never);
  const out = action.output.safeParse(result);
  if (!out.success) {
    ctx.log.error('action output failed its own schema', { action: name, issues: out.error.issues });
    throw new DaifukuError('INTERNAL', `action ${name} returned an invalid result`, 'This is a bug in the action; its output does not match its declared schema.', { issues: out.error.issues });
  }
  return out.data;
}
