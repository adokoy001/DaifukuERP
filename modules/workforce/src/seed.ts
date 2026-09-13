import { repo, withLock, type Context } from '@daifuku/kernel';
import { WorkforcePayPolicy } from './entities/index.ts';
import { JP_ORDINARY_RULES } from './services/policy-data.ts';
/** Idempotent policy only; never creates employee identities or production wage/deduction assumptions. */
export async function seedWorkforce(ctx: Context): Promise<void> {
  await withLock(ctx, 'workforce:policy-seed', async () => {
    if (await repo(ctx, WorkforcePayPolicy).count()) return;
    await repo(ctx, WorkforcePayPolicy).create({
      code: 'JP-ORDINARY-2023',
      name: '日本・通常の労働時間制（会社で就業規則を確認）',
      ...JP_ORDINARY_RULES[0],
      workSystem: 'ordinary',
      weekStartsOn: 1,
      basis:
        'MHLW official ordinary working time and premium rules; effective 2023-04-01. Confirm company workweek/holidays/employment terms before use.',
    });
  });
}
