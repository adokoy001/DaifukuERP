// Definition-dependent ownership validation sits above the opaque capability/context primitive.
import type { Context } from '../context.ts';
import type { EntityDef } from '../dsl/entity.ts';
import { PermissionDenied } from '../errors.ts';
import { registry } from '../registry.ts';
import { ownsField } from '../write-capability.ts';

/** Check original caller input before trusted hooks derive values. */
export function assertOwnedInput(
  ctx: Context,
  entity: EntityDef,
  input: Record<string, unknown>,
  operation: 'create' | 'update',
  previous: Record<string, unknown> = {},
): void {
  const blocked = Object.keys(input).filter(
    (key) => entity.config.fields[key]?.opts.serverOwned && !ownsField(ctx, entity.name, key, operation),
  );
  if (input.ext && typeof input.ext === 'object') {
    const next = input.ext as Record<string, unknown>;
    const prior = (previous.ext ?? {}) as Record<string, unknown>;
    for (const { key, field } of registry.extFields(entity.name)) {
      if (
        field.opts.serverOwned &&
        JSON.stringify(next[key]) !== JSON.stringify(prior[key]) &&
        !ownsField(ctx, entity.name, `ext.${key}`, operation)
      )
        blocked.push(`ext.${key}`);
    }
  }
  if (blocked.length) throw new PermissionDenied(entity.name, `server-owned:${blocked.join(',')}`, ctx.roles);
}
