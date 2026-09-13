import {
  defineEntity,
  defineWriteCapability,
  f,
  label,
  registry,
  repo,
  StateError,
  withLock,
  withWriteCapability,
  type Context,
  type LocalDate,
} from '@daifuku/kernel';

export const INVENTORY_SERIES_LOCK = 'inventory-series';
export const InventoryPeriodClose = defineEntity({
  name: 'inventory_period_close',
  label: label('在庫評価締め履歴', 'Inventory valuation close'),
  fields: {
    throughDate: f.date({
      label: label('締め日', 'Closed through'),
      required: true,
      immutable: true,
      serverOwned: true,
      unique: true,
    }),
    sourceEntity: f.text({
      label: label('締め元', 'Closing source'),
      required: true,
      immutable: true,
      serverOwned: true,
    }),
    sourceId: f.uuid({
      label: label('締め元ID', 'Closing source ID'),
      required: true,
      immutable: true,
      serverOwned: true,
    }),
  },
  permissions: {
    roles: {
      accounting: ['read', 'create'],
      inventory: ['read'],
      sales: ['read'],
      purchasing: ['read'],
      viewer: ['read'],
    },
  },
  views: { list: ['throughDate', 'sourceEntity', 'sourceId'] },
});
const closer = defineWriteCapability({
  name: 'inventory.close',
  entity: InventoryPeriodClose.name,
  fields: ['throughDate', 'sourceEntity', 'sourceId'],
  operations: ['create'],
});

export function registerPeriodCloseHooks(): void {
  for (const op of ['before_update', 'before_delete'] as const)
    registry.registerHook(InventoryPeriodClose.name, op, () => {
      throw new StateError('Inventory valuation closes are immutable', 'Post a correction after the closed date.');
    });
}

export async function assertInventoryDate(ctx: Context, date: LocalDate): Promise<void> {
  await withLock(ctx, INVENTORY_SERIES_LOCK, async () => undefined);
  const latest = (
    await repo(ctx, InventoryPeriodClose).list({ orderBy: [{ field: 'throughDate', dir: 'desc' }], limit: 1 })
  ).items[0];
  if (latest && date <= latest.throughDate)
    throw new StateError(
      `Inventory valuation is closed through ${latest.throughDate}`,
      'Use an effective date after the closed valuation period.',
    );
}

/** Called by a closing module in the same transaction as its GL posting and closing record. */
export async function closeInventoryThrough(
  ctx: Context,
  throughDate: LocalDate,
  source: { entity: string; id: string },
): Promise<void> {
  await assertInventoryDate(ctx, throughDate);
  await withWriteCapability(ctx, closer, (internal) =>
    repo(internal, InventoryPeriodClose).create({ throughDate, sourceEntity: source.entity, sourceId: source.id }),
  );
}
