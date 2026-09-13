// AC-2: product.uomId は業務上必須。作成時に省略されたら会社の「個」を補い、null への更新は拒む。
// DSL の required（NOT NULL）にすると汎用 create アクションが before_validate より先に Zod 検証で uomId 省略を
// 拒むため、必須性はこのフックで担保する（kernel 側の改善候補。作業記録参照）。
import { ValidationError, registry, type Context, type HookArgs } from '@daifuku/kernel';
import { DEFAULT_UOM_CODE, findUomByCode } from '../seeds/uoms.ts';

const required = (): ValidationError =>
  new ValidationError(
    'product.uomId is required',
    [{ path: 'uomId', message: 'required' }],
    'Pass the id of a uom (see uom.list).',
  );

export async function applyDefaultUom(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  if (previous) {
    // update patch: absent = unchanged; explicit null would break the invariant.
    if ('uomId' in row && row.uomId === null) throw required();
    return;
  }
  if (row.uomId !== undefined && row.uomId !== null) return;
  const uom = await findUomByCode(ctx, DEFAULT_UOM_CODE);
  if (!uom) {
    throw new ValidationError(
      `product.uomId is required and the default unit (uom code ${DEFAULT_UOM_CODE}) does not exist in this company`,
      [{ path: 'uomId', message: 'required' }],
      'Pass uomId explicitly, or seed the standard units first (product module seed).',
    );
  }
  row.uomId = uom.id;
}

export function registerProductHooks(): void {
  registry.registerHook('product', 'before_validate', applyDefaultUom);
}
