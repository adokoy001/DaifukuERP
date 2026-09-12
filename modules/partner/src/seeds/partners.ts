// Spec AC-9: three sample partners, inserted only when their code is absent (idempotent on re-run).
import type { Context, InsertInput } from '@daifuku/kernel';
import { repo } from '@daifuku/kernel';
import { Partner } from '../entities/partner.ts';

type PartnerInsert = InsertInput<typeof Partner> & { code: string };

export const SEED_PARTNERS: readonly PartnerInsert[] = [
  {
    code: 'C-0001',
    name: '株式会社サンプル商事',
    nameKana: 'カブシキガイシャサンプルショウジ',
    isCustomer: true,
    invoiceRegistrationNo: 'T1234567890123',
    taxStatus: 'registered',
    closingDay: 31,
    paymentMonthOffset: 1,
    paymentDay: 31,
    postalCode: '100-0001',
    prefecture: '東京都',
    address1: '千代田区千代田1-1',
    bankName: 'サンプル銀行',
    bankBranch: '本店',
    bankAccountType: 'ordinary',
    bankAccountNo: '1234567',
    bankAccountHolderKana: 'カ）サンプルショウジ',
  },
  {
    code: 'S-0001',
    name: '大福物産株式会社',
    nameKana: 'ダイフクブッサンカブシキガイシャ',
    isSupplier: true,
    invoiceRegistrationNo: 'T9876543210987',
    taxStatus: 'registered',
    closingDay: 20,
    paymentMonthOffset: 1,
    paymentDay: 10,
    postalCode: '530-0001',
    prefecture: '大阪府',
    address1: '大阪市北区梅田1-1',
  },
  {
    code: 'B-0001',
    name: '山田太郎',
    nameKana: 'ヤマダタロウ',
    isCustomer: true,
    isSupplier: true,
    taxStatus: 'exempt',
    closingDay: 15,
    paymentMonthOffset: 2,
    paymentDay: 31,
    notes: '免税事業者（個人）。仕入税額控除の経過措置の対象。',
  },
];

export async function seedPartners(ctx: Context): Promise<void> {
  const r = repo(ctx, Partner);
  const existing = await r.list({ where: { code: { $in: SEED_PARTNERS.map((p) => p.code) } }, limit: SEED_PARTNERS.length });
  const present = new Set(existing.items.map((p) => p.code));
  for (const p of SEED_PARTNERS) {
    if (present.has(p.code)) continue;
    await r.create(p);
  }
}
