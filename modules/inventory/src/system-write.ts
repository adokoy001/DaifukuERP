// Private module capabilities: ordinary role/row permissions remain required.
import { defineWriteCapability, hasWriteCapability, withWriteCapability, type Context } from '@daifuku/kernel';
const grants = [
  defineWriteCapability({ name: 'inventory.ledger', entity: 'stock_ledger', operations: ['create'] }),
  defineWriteCapability({ name: 'inventory.balance', entity: 'stock_balance', operations: ['create', 'update'] }),
  defineWriteCapability({ name: 'inventory.entry', entity: 'stock_entry', fields: ['sourceEntity', 'sourceId'], operations: ['create', 'update'] }),
  defineWriteCapability({ name: 'inventory.entry-line', entity: 'stock_entry_line', fields: ['unitCost', 'amount'], operations: ['update'] }),
  defineWriteCapability({ name: 'inventory.count', entity: 'stock_count', fields: ['adjustmentEntryId'], operations: ['update'] }),
  defineWriteCapability({ name: 'inventory.count-line', entity: 'stock_count_line', fields: ['systemQty', 'varianceQty'], operations: ['update'] }),
];
export const isModuleWrite = (ctx: Context): boolean => hasWriteCapability(ctx, 'stock_ledger', 'create');
export async function asModule<T>(ctx: Context, fn: (ctx: Context) => Promise<T>): Promise<T> {
  const apply = (index: number, current: Context): Promise<T> => {
    const grant = grants[index];
    return grant ? withWriteCapability(current, grant, (child) => apply(index + 1, child)) : fn(current);
  };
  return apply(0, ctx);
}
