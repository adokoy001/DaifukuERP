import { describe, expect, it } from 'vitest';
import { assertNonDestructive } from '../src/db/migrations.ts';

describe('foundation-refresh migration safety', () => {
  it('AC-3 blocks implicit removal of persisted tables, columns, and schemas', () => {
    for (const statement of [
      'DROP TABLE "real_estate_deposit" CASCADE;',
      'ALTER TABLE "partner" DROP COLUMN "notes";',
      'DROP SCHEMA public CASCADE;',
    ]) {
      expect(() => assertNonDestructive([statement])).toThrow('remove tables or columns');
    }
  });

  it('AC-3 allows additive migrations and replacing constraints or policies', () => {
    expect(() =>
      assertNonDestructive([
        'ALTER TABLE "partner" ADD COLUMN "snapshot" jsonb;',
        'ALTER TABLE "partner" DROP CONSTRAINT "old_fk";',
        'DROP POLICY "old_policy" ON "partner";',
      ]),
    ).not.toThrow();
  });
});
