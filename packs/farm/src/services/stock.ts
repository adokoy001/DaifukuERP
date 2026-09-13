import {
  cancelDocument,
  DOCSTATUS,
  repo,
  saveLines,
  StateError,
  submitDocument,
  type Context,
  type Decimal,
  type HookArgs,
  type LocalDate,
} from '@daifuku/kernel';
import { StockEntry, StockEntryLine } from '@daifuku/mod-inventory';
import type { FarmHarvest } from '../entities/harvest.ts';
import type { FarmWork } from '../entities/work.ts';
import { asFarm } from '../system-write.ts';
import { invalid } from './validation.ts';

type FarmDocument = typeof FarmWork | typeof FarmHarvest;
type StockLine = { productId: string; quantity: Decimal; unitCost?: Decimal };
export async function createStock(
  ctx: Context,
  entity: FarmDocument,
  row: Record<string, unknown>,
  type: 'issue' | 'receipt',
  lines: StockLine[],
): Promise<void> {
  if (row.stockEntryId)
    throw new StateError('Farm document already has a stock entry', 'Reload the document; do not post it twice.');
  const entry = await repo(ctx, StockEntry).create({
    type,
    date: row.date as LocalDate,
    warehouseId: String(row.warehouseId),
    note: `${entity.config.label.ja} ${String(row.number)}`,
  });
  await saveLines(ctx, StockEntry, entry.id, { [StockEntryLine.name]: lines });
  await submitDocument(ctx, StockEntry, entry.id);
  await asFarm(ctx, async (internal) => {
    await repo(internal, entity).update(String(row.id), { stockEntryId: entry.id });
  });
}

export async function cancellationDate(_ctx: Context, { row, correctionDate }: HookArgs): Promise<void> {
  const date = correctionDate ?? (row.date as LocalDate);
  if (date < String(row.date))
    invalid('correctionDate', 'Cancellation cannot be effective before the original work or harvest.');
  row.cancelledDate = date;
}

/** Parent is now cancelled, so its submitted dependency no longer blocks the child. One transaction rolls both back. */
export async function cancelStock(ctx: Context, { row, correctionDate, entity }: HookArgs): Promise<void> {
  if (!row.stockEntryId) {
    if (entity === 'farm_harvest')
      throw new StateError('Submitted harvest has no stock receipt', 'Restore the missing linkage before cancelling.');
    return;
  }
  const entry = await repo(ctx, StockEntry).get(String(row.stockEntryId));
  if (entry.docstatus !== DOCSTATUS.submitted)
    throw new StateError('Linked stock entry is not submitted', 'Repair the linked stock state before retrying.');
  await cancelDocument(ctx, StockEntry, entry.id, { correctionDate });
}
