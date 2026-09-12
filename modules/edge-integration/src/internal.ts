import { defineWriteCapability, hasWriteCapability, registry, withWriteCapability, StateError, repo, withRelayLock, type Context, type EntityDef } from '@daifuku/kernel';
import { WorkforceSite } from '@daifuku/mod-workforce';
import { EdgeGateway, EdgeDevice, EdgeJob, EdgeDeviceEvent } from './entities.ts';
const managed = [EdgeGateway, EdgeDevice, EdgeJob, EdgeDeviceEvent];
const caps = new Map(managed.map((e) => [e.name, defineWriteCapability({ name: e.name + '.workflow', entity: e.name, fields: e.fieldNames, operations: ['create', 'update', 'workflow'] })]));
export function edgeWrite<T>(ctx: Context, e: EntityDef, work: (inner: Context) => Promise<T>) { const cap = caps.get(e.name); if (!cap) throw new Error('Unknown edge authority'); return withWriteCapability(ctx, cap, work); }
export function registerEdgeGuards() {
  for (const e of managed) for (const phase of ['before_create', 'before_update', 'before_delete'] as const) registry.registerHook(e.name, phase, (ctx) => { if (phase === 'before_delete' || !hasWriteCapability(ctx, e.name, 'workflow')) throw new StateError('Use the edge workflow', 'Device configuration and execution history cannot be changed through generic CRUD.'); });
  registry.registerHook(WorkforceSite.name, 'before_update', async (ctx, { row, previous }) => {
    if (row.active !== false || previous?.active === false) return;
    // Config changes and site deactivation share one company lock, before gateway locks.
    await withRelayLock(ctx, 'site:' + String(row.id), async () => {
      if (await repo(ctx, EdgeGateway).count({ siteId: String(row.id), active: true })) throw new StateError('The site has active LAN gateways', 'Disable its gateways before disabling this site.');
    });
  });
}
