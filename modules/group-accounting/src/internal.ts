import { defineWriteCapability, hasWriteCapability, registry, StateError, withWriteCapability, type Context } from '@daifuku/kernel';
import { GroupRun } from './entity.ts';
const capability = defineWriteCapability({ name: 'group_accounting.workflow', entity: GroupRun.name, fields: GroupRun.fieldNames, operations: ['create', 'update', 'workflow'] });
export const writeGroup = <T>(ctx: Context, work: (inner: Context) => Promise<T>) => withWriteCapability(ctx, capability, work);
export function registerGroupGuards() { for (const phase of ['before_create', 'before_update', 'before_delete'] as const) registry.registerHook(GroupRun.name, phase, (ctx) => { if (phase === 'before_delete' || !hasWriteCapability(ctx, GroupRun.name, 'workflow')) throw new StateError('Use consolidation workflow actions', 'Snapshots are immutable after confirmation and cannot be changed through generic CRUD.'); }); }
