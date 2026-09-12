import { repo, withLock, type Context } from '@daifuku/kernel';
import { Warehouse } from '@daifuku/mod-inventory';
import { Uom } from '@daifuku/mod-product';
export const FARM_WAREHOUSE_CODE = 'FARM';
export async function seedFarm(ctx: Context): Promise<void> {
  await withLock(ctx, 'farm.seed', async () => {
    if (!await repo(ctx, Uom).count({ code: 'KGM' })) await repo(ctx, Uom).create({ code: 'KGM', name: 'kg', symbol: 'kg' });
    if (!await repo(ctx, Warehouse).count({ code: FARM_WAREHOUSE_CODE })) await repo(ctx, Warehouse).create({ code: FARM_WAREHOUSE_CODE, name: '農産物・資材倉庫' });
  });
}
