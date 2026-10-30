// docs/specs/fixed-assets.md AC-29: the Japanese chart (l10n/jp) and the industry packs' seeded accounts never share a
// code. Pack seeds skip codes that already exist, so a collision would leave a pack's account under another name/type
// (e.g. 4200 賃貸料収入 of real-estate posting to a fixed-asset gain account).
import { JP_CHART_OF_ACCOUNTS } from '@daifuku/l10n-jp';
import { SEED_ACCOUNTS } from '@daifuku/pack-real-estate';
import { RETAIL_ACCOUNTS } from '@daifuku/pack-retail';
import { describe, expect, it } from 'vitest';

describe('chart of accounts codes (fixed-assets AC-29)', () => {
  it('AC-29: no Japanese chart code is also seeded by an industry pack', () => {
    const jp = new Set(JP_CHART_OF_ACCOUNTS.map((a) => a.code));
    const packCodes = [...SEED_ACCOUNTS.map((a) => a.code), ...RETAIL_ACCOUNTS.map((a) => a.code)];
    expect(packCodes).toEqual(expect.arrayContaining(['4200', '4210', '5050', '5100', '6990']));
    expect(packCodes.filter((code) => jp.has(code))).toEqual([]);
    for (const code of ['1910', '1920', '1925', '1929', '1930', '8100', '8200', '8300'])
      expect(jp.has(code)).toBe(true);
  });
});
