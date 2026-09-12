import { defineWriteCapability, withWriteCapability, type Context } from '@daifuku/kernel';
const season = defineWriteCapability({ name: 'farm.season-owned', entity: 'farm_season', fields: ['sampleKey', 'closedDate'], operations: ['create', 'update'] });
const work = defineWriteCapability({ name: 'farm.work-owned', entity: 'farm_work', fields: ['sampleKey', 'stockEntryId'], operations: ['create', 'update'] });
const harvest = defineWriteCapability({ name: 'farm.harvest-owned', entity: 'farm_harvest', fields: ['sampleKey', 'stockEntryId'], operations: ['create', 'update'] });
// Only pack services call this helper; normal entity/row permissions and company scope remain in force.
export function asFarm<T>(ctx: Context, fn: (internal: Context) => Promise<T>): Promise<T> {
  return withWriteCapability(ctx, season, (a) => withWriteCapability(a, work, (b) => withWriteCapability(b, harvest, fn)));
}
