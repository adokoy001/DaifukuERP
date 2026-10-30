// Module-private write authority (ADR-0016): only expense implementation files import this; it is never exported from
// the package index. The capabilities own the server-owned fields the hooks and actions write.
import { defineWriteCapability, withWriteCapability, type Context, type EntityDef } from '@daifuku/kernel';
import { ExpenseAdvance, ExpenseSettlement, ExpenseSettlementLine } from './entities/index.ts';

const capabilities = new Map(
  [ExpenseSettlement, ExpenseSettlementLine, ExpenseAdvance].map((entity: EntityDef) => [
    entity.name,
    defineWriteCapability({
      name: `${entity.name}.expense`,
      entity: entity.name,
      fields: entity.fieldNames.filter((field) => entity.config.fields[field]?.opts.serverOwned),
      operations: ['create', 'update'],
    }),
  ]),
);

export function internalWrite<T>(ctx: Context, entity: EntityDef, work: (ctx: Context) => Promise<T>): Promise<T> {
  const capability = capabilities.get(entity.name);
  if (!capability) throw new Error(`Unregistered expense write capability for ${entity.name}`);
  return withWriteCapability(ctx, capability, work);
}
