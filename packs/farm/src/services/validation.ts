import {
  Decimal,
  DOCSTATUS,
  NotFound,
  repo,
  StateError,
  todayLocal,
  ValidationError,
  type Context,
} from '@daifuku/kernel';
import { Product, Uom } from '@daifuku/mod-product';
import { FarmSeason } from '../entities/season.ts';

export function decimal(value: unknown): Decimal {
  return Decimal.from(String(value ?? '0'));
}
export function invalid(path: string, message: string): never {
  throw new ValidationError(message, [{ path, message }]);
}

export async function goods(ctx: Context, id: unknown): Promise<{ productId: string; uomCode: string }> {
  if (typeof id !== 'string') return invalid('productId', 'Choose a goods product.');
  const product = await repo(ctx, Product).get(id);
  if (product.kind !== 'goods') return invalid('productId', 'Only goods can be grown or consumed as stock materials.');
  if (!product.uomId)
    throw new StateError('Product has no stock unit', 'Set the product stock unit before recording farm activity.');
  const unit = await repo(ctx, Uom).get(product.uomId);
  return { productId: product.id, uomCode: unit.code };
}

/** A common lock prevents close/create/submit races. Draft planning under a draft season is permitted. */
export async function openSeason(ctx: Context, seasonId: unknown, date: unknown, submitting: boolean) {
  if (typeof seasonId !== 'string') throw new NotFound(FarmSeason.name, String(seasonId));
  const season = await repo(ctx, FarmSeason).lock(seasonId, 'read');
  if (
    season.closedDate ||
    season.docstatus === DOCSTATUS.cancelled ||
    (submitting && season.docstatus !== DOCSTATUS.submitted)
  ) {
    throw new StateError(
      'The growing season is not open for this operation',
      'Submit the season first; use an open season for new work or harvests.',
    );
  }
  if (typeof date !== 'string' || date < season.startDate || date > season.endDate)
    invalid('date', 'The date must be inside the growing season.');
  if (submitting && date > todayLocal(ctx.now())) invalid('date', 'Future work and harvests cannot be submitted.');
  return season;
}
