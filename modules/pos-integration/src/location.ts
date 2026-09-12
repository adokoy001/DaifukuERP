import { repo, registry, StateError, ValidationError, type Context, type HookArgs } from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import { PosLocation } from './entities.ts';
export async function assertLocationAccounts(ctx: Context, row: Record<string, unknown>) {
  const asset = await repo(ctx, Account).get(String(row.settlementAccountId)), suspense = await repo(ctx, Account).get(String(row.suspenseAccountId));
  if (!asset.isActive || asset.type !== 'asset' || asset.partnerRequired || asset.taxRole !== 'none' || !suspense.isActive || suspense.type !== 'liability' || suspense.partnerRequired || suspense.taxRole !== 'none') throw new StateError('POS clearing account mapping is invalid', 'Select active asset and liability clearing accounts without tax or partner requirements. Do not infer sales tax from settlement totals.');
}
async function validate(ctx: Context, { row, previous }: HookArgs) {
  const merged = { ...previous, ...row };
  if (!merged.merchantId || !merged.externalLocationId) throw new ValidationError('Square identity is required', [], 'Configure the exact merchant and location IDs.');
  row.mappingKey = `square:${String(merged.merchantId)}:${String(merged.externalLocationId)}`;
  await assertLocationAccounts(ctx, merged);
}
export function registerLocationGuards() { registry.registerHook(PosLocation.name, 'before_validate', validate); }
