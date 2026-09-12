// Demo data (AC-6): two partners with ranks. The second takes the company's default rank setting, which applyPack has
// written (or left as the admin set it) before sample runs. Skips codes that already exist, so a forced re-run is safe.
import { getSetting, repo, type Context } from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { DEFAULT_RANK, DEFAULT_RANK_KEY, defaultRankSchema } from './settings.ts';

export const SAMPLE_PARTNER_CODES = ['EX-0001', 'EX-0002'] as const;

export async function sampleExample(ctx: Context): Promise<void> {
  const r = repo(ctx, Partner);
  const existing = await r.list({ where: { code: { $in: [...SAMPLE_PARTNER_CODES] } }, limit: SAMPLE_PARTNER_CODES.length });
  const present = new Set(existing.items.map((p) => p.code));
  const defaultRank = await getSetting(ctx, DEFAULT_RANK_KEY, defaultRankSchema, DEFAULT_RANK);
  const rows = [
    { code: SAMPLE_PARTNER_CODES[0], name: 'サンプル得意先A', isCustomer: true, ext: { customerRank: 'A', note2: '年間契約あり' } },
    { code: SAMPLE_PARTNER_CODES[1], name: 'サンプル仕入先B', isSupplier: true, ext: { customerRank: defaultRank, note2: 'スポット取引' } },
  ];
  for (const row of rows) {
    if (!present.has(row.code)) await r.create(row);
  }
}
