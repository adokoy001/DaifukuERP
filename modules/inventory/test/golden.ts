// Loader for test/golden/moving-average.json (shared by the unit test and the DB replay in inventory.db.test.ts).
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const dec = z.string().regex(/^-?\d+(\.\d+)?$/);
const expectSchema = z.object({ qtyDelta: dec, costDelta: dec, unitCost: dec, balanceQty: dec, balanceCost: dec });
const stepSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('receipt'), qty: dec, unitCost: dec, expect: expectSchema }),
  z.object({ op: z.literal('issue'), qty: dec, expect: expectSchema }),
  z.object({ op: z.literal('reverse_receipt'), qty: dec, totalCost: dec, expect: expectSchema }),
  z.object({ op: z.literal('reverse_issue'), qty: dec, totalCost: dec, expect: expectSchema }),
]);

export const goldenSchema = z.object({
  description: z.string(),
  scenarios: z.array(z.object({ name: z.string(), allowNegative: z.boolean(), steps: z.array(stepSchema).min(1) })).min(1),
});
export type Golden = z.output<typeof goldenSchema>;
export type GoldenStep = Golden['scenarios'][number]['steps'][number];

export const golden: Golden = goldenSchema.parse(JSON.parse(readFileSync(new URL('./golden/moving-average.json', import.meta.url), 'utf8')));
