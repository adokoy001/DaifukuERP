import { type Decimal, getCompany, ValidationError, type Context } from '@daifuku/kernel';

/** Current operational contract: JPY settlement in whole yen; quantity/unit prices may have fractions. */
export async function assertJpySettlement(ctx: Context, amount: Decimal, path = 'total'): Promise<void> {
  const company = await getCompany(ctx);
  if (company.currency !== 'JPY')
    throw new ValidationError('This posting flow currently supports JPY only', [
      { path: 'currency', message: 'JPY is required; foreign-currency accounting is not implemented' },
    ]);
  if (!amount.eq(amount.roundHalfUp(0)))
    throw new ValidationError('The final JPY settlement amount must be whole yen', [
      { path, message: 'agree a whole-yen payable amount; adjust quantity or unit price before submitting' },
    ]);
}
