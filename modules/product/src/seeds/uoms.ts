// 標準単位のシード（AC-1）。code は UN/ECE Recommendation 20 の単位コード（JP PINT が同じコード表を使う）。
import { repo, type Context } from '@daifuku/kernel';
import { Uom } from '../entities/uom.ts';

export interface StandardUom {
  code: string;
  name: string;
  symbol: string;
}

/** 「個」。product.uomId の既定値に使う（AC-2）。 */
export const DEFAULT_UOM_CODE = 'H87';

export const STANDARD_UOMS: readonly StandardUom[] = [
  { code: DEFAULT_UOM_CODE, name: '個', symbol: '個' },
  { code: 'SET', name: '式', symbol: '式' },
  { code: 'HUR', name: '時間', symbol: 'h' },
  { code: 'KGM', name: 'kg', symbol: 'kg' },
  { code: 'BX', name: '箱', symbol: '箱' },
];

/** Returns the uom with the given code in the context's company, or null. */
export async function findUomByCode(ctx: Context, code: string): Promise<{ id: string } | null> {
  const { items } = await repo(ctx, Uom).list({ where: { code }, limit: 1 });
  return items[0] ?? null;
}

/** Idempotent: creates each standard unit that does not exist yet (matched by code). */
export async function seedUoms(ctx: Context): Promise<void> {
  const r = repo(ctx, Uom);
  for (const u of STANDARD_UOMS) {
    if (await findUomByCode(ctx, u.code)) continue;
    await r.create(u);
  }
}
