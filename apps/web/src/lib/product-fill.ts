import type { FieldMeta, RecordJson } from '../api/types.ts';
import type { FormValues } from './form.ts';

/** UI preview of the product defaults; server hooks remain authoritative. No amount arithmetic uses JS numbers. */
export function productDefaults(product: RecordJson, columns: readonly FieldMeta[], purchasing: boolean): FormValues {
  const candidates: Record<string, unknown> = {
    description: product.name,
    uomId: product.uomId,
    taxCategory: product.taxCategory,
    unitPrice: purchasing ? product.purchasePrice : product.salePrice,
  };
  const values: FormValues = {};
  for (const field of columns) {
    const value = candidates[field.name];
    if (!field.serverOwned && !field.readOnly && typeof value === 'string') values[field.name] = value;
  }
  return values;
}
