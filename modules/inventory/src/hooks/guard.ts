// stock_ledger is append-only and stock_balance is derived (docs/specs/inventory.md AC-1, ADR-0005). Both are written
// only by src/ledger.ts inside `asModule`; these hooks refuse every other path — the generic <entity>.create/update/
// delete actions, repo calls from other modules or packs, and admin (who implicitly holds every op) included.
import { registry, StateError, type Context, type HookArgs } from '@daifuku/kernel';
import { StockBalance } from '../entities/stock-balance.ts';
import { StockLedger } from '../entities/stock-ledger.ts';
import { isModuleWrite } from '../system-write.ts';

export const LEDGER_WRITE_HINT = 'Stock moves only through documents: submit a stock_entry (or a purchase/sales invoice, a stock_count); cancel it to append the reverse rows.';

function refuse(entity: string, op: string, id: unknown): StateError {
  return new StateError(`${entity} rows cannot be ${op} directly (${entity === StockLedger.name ? 'append-only ledger' : 'derived from the ledger'})`, LEDGER_WRITE_HINT, { entity, op, id });
}

function onlyModule(entity: string, op: string) {
  return (ctx: Context, { row, previous }: HookArgs): void => {
    if (!isModuleWrite(ctx)) throw refuse(entity, op, previous?.id ?? row.id);
  };
}

function never(entity: string, op: string) {
  return (_ctx: Context, { row }: HookArgs): void => {
    throw refuse(entity, op, row.id);
  };
}

export function registerGuardHooks(): void {
  // before_validate runs before zod, so a malformed direct write gets the same answer as a well-formed one
  registry.registerHook(StockLedger.name, 'before_validate', (ctx, args) => onlyModule(StockLedger.name, args.previous ? 'updated' : 'created')(ctx, args));
  registry.registerHook(StockLedger.name, 'before_update', never(StockLedger.name, 'updated'));
  registry.registerHook(StockLedger.name, 'before_delete', never(StockLedger.name, 'deleted'));
  registry.registerHook(StockBalance.name, 'before_validate', (ctx, args) => onlyModule(StockBalance.name, args.previous ? 'updated' : 'created')(ctx, args));
  registry.registerHook(StockBalance.name, 'before_delete', never(StockBalance.name, 'deleted'));
}
