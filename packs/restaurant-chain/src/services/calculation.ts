import { Decimal, ValidationError } from '@daifuku/kernel';
export function servingCategory(mode: string, alcohol: boolean): 'standard' | 'reduced' {
  return mode === 'takeaway' && !alcohol ? 'reduced' : 'standard';
}
export function addIngredient(target: Map<string, Decimal>, productId: string, quantity: Decimal): void {
  if (!quantity.gt(0) || !quantity.eq(quantity.roundDown(6))) throw new ValidationError('材料数量は正の値・小数6桁以内で指定してください', [{ path: 'quantity', message: 'positive quantity with at most 6 decimals required' }]);
  target.set(productId, (target.get(productId) ?? Decimal.zero()).plus(quantity));
}
export function tenderTotal(cash: Decimal, card: Decimal, qr: Decimal, total: Decimal): void {
  const sum = cash.plus(card).plus(qr);
  if (!sum.eq(total)) throw new ValidationError('現金・カード・QRの合計が税込売上と一致しません', [{ path: 'cashAmount', message: `tender ${sum.toString()} must equal gross sales ${total.toString()}` }]);
}
