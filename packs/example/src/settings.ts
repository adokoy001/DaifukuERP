// The pack's own company setting (ADR-0013 L1). None of the modules this pack depends on (partner) declares a plain-valued
// setting, so the pack declares one and ships its default through definePack `settings` (applied by pack:apply).
import { label, type SettingDef } from '@daifuku/kernel';
import { z } from 'zod';

export const CUSTOMER_RANKS = ['A', 'B', 'C'] as const;
export type CustomerRank = (typeof CUSTOMER_RANKS)[number];

export const DEFAULT_RANK_KEY = 'example.default_customer_rank';
export const defaultRankSchema = z.enum(CUSTOMER_RANKS);
export const DEFAULT_RANK: CustomerRank = 'B';

export const DEFAULT_RANK_SETTING: SettingDef<CustomerRank> = {
  key: DEFAULT_RANK_KEY,
  label: label('既定の顧客ランク', 'Default customer rank'),
  description: label('サンプル取引先などでランク未指定のときに使う', 'Used when a partner is created without a rank (e.g. sample data)'),
  schema: defaultRankSchema,
};
