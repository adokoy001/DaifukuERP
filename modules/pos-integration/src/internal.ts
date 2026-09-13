import {
  defineWriteCapability,
  hasWriteCapability,
  registry,
  withWriteCapability,
  StateError,
  type Context,
  type EntityDef,
} from '@daifuku/kernel';
import { PosInbox, PosTransaction } from './entities.ts';
const managed = [PosInbox, PosTransaction];
const capabilities = new Map(
  managed.map((e) => [
    e.name,
    defineWriteCapability({
      name: e.name + '.workflow',
      entity: e.name,
      fields: e.fieldNames,
      operations: ['create', 'update', 'workflow'],
    }),
  ]),
);
export function internalWrite<T>(ctx: Context, entity: EntityDef, work: (inner: Context) => Promise<T>) {
  const cap = capabilities.get(entity.name);
  if (!cap) throw new Error('Unknown POS authority');
  return withWriteCapability(ctx, cap, work);
}
export function registerPosGuards() {
  for (const e of managed)
    for (const phase of ['before_create', 'before_update', 'before_delete'] as const)
      registry.registerHook(e.name, phase, (ctx) => {
        if (phase === 'before_delete' || !hasWriteCapability(ctx, e.name, 'workflow'))
          throw new StateError(
            'Use the POS inbox workflow',
            'POS source records cannot be changed through generic CRUD.',
          );
      });
}
