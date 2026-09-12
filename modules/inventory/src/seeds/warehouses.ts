// Seed (docs/specs/inventory.md AC-1): the main warehouse MAIN, the default of `inventory.default_warehouse`.
import { repo, type Context, type InsertInput } from '@daifuku/kernel';
import { Warehouse } from '../entities/warehouse.ts';

export const SEED_WAREHOUSES: readonly InsertInput<typeof Warehouse>[] = [{ code: 'MAIN', name: '本店（主倉庫）', isDefault: true }];

/** Idempotent per company: a warehouse whose code already exists is left untouched. */
export async function seedWarehouses(ctx: Context): Promise<void> {
  const r = repo(ctx, Warehouse);
  for (const w of SEED_WAREHOUSES) {
    const existing = await r.list({ where: { code: w.code }, limit: 1 });
    if (existing.items.length > 0) continue;
    await r.create(w);
  }
}
