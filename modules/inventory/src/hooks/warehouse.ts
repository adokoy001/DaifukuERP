// warehouse hooks (docs/specs/inventory.md AC-1): at most one warehouse is flagged isDefault — saving one with
// isDefault = true clears the flag on the others (in the same transaction, through the repository).
import { registry, repo, type Context, type HookArgs } from '@daifuku/kernel';
import { Warehouse } from '../entities/warehouse.ts';

async function clearOtherDefaults(ctx: Context, { row }: HookArgs): Promise<void> {
  if (row.isDefault !== true) return;
  const others = await repo(ctx, Warehouse).list({
    where: { isDefault: true, id: { $ne: row.id as string } },
    limit: 500,
  });
  for (const w of others.items) await repo(ctx, Warehouse).update(w.id, { isDefault: false });
}

export function registerWarehouseHooks(): void {
  registry.registerHook(Warehouse.name, 'after_create', clearOtherDefaults);
  registry.registerHook(Warehouse.name, 'after_update', clearOtherDefaults);
}
