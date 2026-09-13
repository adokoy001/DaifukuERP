import { repo, type Context } from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';

export const WALK_IN_CODE = 'RC-WALKIN';
/** Operational seed only; no stores or transactions are silently installed. */
export async function seedRestaurantChain(ctx: Context): Promise<void> {
  if (await repo(ctx, Partner).count({ code: WALK_IN_CODE })) return;
  await repo(ctx, Partner).create({
    code: WALK_IN_CODE,
    name: '飲食店・店頭客',
    isCustomer: true,
    notes: '店舗の日次締め用。カード・QRは実入金まで売掛に残します。',
  });
}
