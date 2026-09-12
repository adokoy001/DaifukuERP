import { repo, ValidationError, type Context } from '@daifuku/kernel';
import { Product } from './entities/product.ts';
import { Uom } from './entities/uom.ts';

/** Transaction units are snapshotted; goods currently require their fixed stock unit (no implicit conversion). */
export async function fillLineUom(ctx: Context, { row, previous }: { row: Record<string, unknown>; previous?: Record<string, unknown> | undefined }): Promise<void> {
  const productId = row.productId ?? previous?.productId;
  const changedProduct = row.productId !== undefined && row.productId !== previous?.productId;
  if (previous && !changedProduct && row.uomId === undefined) return;
  const product = typeof productId === 'string' ? await repo(ctx, Product).find(productId) : null;
  const id = row.uomId ?? (changedProduct ? product?.uomId : previous?.uomId) ?? product?.uomId;
  if (product?.kind === 'goods' && id !== product.uomId) throw new ValidationError('Goods must use their stock unit', [{ path: 'uomId', message: 'unit conversion is not implemented; use the product stock unit' }]);
  if (typeof id !== 'string') {
    row.uomId = null;
    row.uomCode = 'unit';
    return;
  }
  const uom = await repo(ctx, Uom).get(id);
  row.uomId = id;
  row.uomCode = uom.code;
}
