// stock_entry before_cancel (docs/specs/inventory.md AC-4): the roles must cover the type (AC-9), then the reverse of
// every posted ledger row is appended (src/ledger.ts reverseSource: never deleted, same date, balances moved by the same
// moving-average rules). A reversal that would take stock below zero is refused unless inventory.allow_negative_stock.
// The kernel then writes docstatus = 2 in the same transaction. An adjustment linked from a submitted stock_count is
// refused earlier by the kernel's dependents check (cancel the count instead).
import { registry, type Context, type HookArgs } from '@daifuku/kernel';
import { StockEntry } from '../entities/stock-entry.ts';
import { reverseSource } from '../ledger.ts';
import { allowNegativeStock } from '../settings.ts';
import { assertEntryRole } from './entry.ts';

async function beforeCancel(ctx: Context, { row, correctionDate }: HookArgs): Promise<void> {
  assertEntryRole(ctx, row.type, 'cancel');
  await reverseSource(ctx, StockEntry.name, row.id as string, await allowNegativeStock(ctx), correctionDate);
}

export function registerCancelHook(): void {
  registry.registerHook(StockEntry.name, 'before_cancel', beforeCancel);
}
