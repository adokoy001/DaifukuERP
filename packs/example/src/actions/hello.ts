// example.hello (AC-6): reads through a pack ext field — counts partners with ext.customerRank = 'A'.
import { defineAction, label, repo } from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { z } from 'zod';

export const helloAction = defineAction({
  name: 'example.hello',
  description: label(
    'ランク A の取引先の件数を返します（パックの動作確認用）。',
    'Count partners whose customer rank is A (pack smoke test).',
  ),
  input: z.object({}),
  output: z.object({ count: z.number().int() }),
  permission: { entity: Partner.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: async (ctx) => ({ count: await repo(ctx, Partner).count({ 'ext.customerRank': 'A' }) }),
});
