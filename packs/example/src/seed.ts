// Idempotent masters (AC-6): three tags, inserted only when their code is absent.
import { repo, type Context } from '@daifuku/kernel';
import { ExampleTag } from './entities/example-tag.ts';

export const SEED_TAGS: readonly { code: string; name: string }[] = [
  { code: 'vip', name: '重要顧客' },
  { code: 'new', name: '新規' },
  { code: 'dormant', name: '休眠' },
];

export async function seedExample(ctx: Context): Promise<void> {
  const r = repo(ctx, ExampleTag);
  const existing = await r.list({ where: { code: { $in: SEED_TAGS.map((t) => t.code) } }, limit: SEED_TAGS.length });
  const present = new Set(existing.items.map((t) => t.code));
  for (const t of SEED_TAGS) {
    if (!present.has(t.code)) await r.create(t);
  }
}
