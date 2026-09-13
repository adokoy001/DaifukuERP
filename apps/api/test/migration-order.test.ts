import { describe, expect, it } from 'vitest';
import { orderMigrationConstraints } from '../src/db/migrations.ts';
describe('migration prerequisite ordering', () => {
  it('creates added columns and tables before a unique key, then the foreign key referencing it', () => {
    const column = 'ALTER TABLE "users" ADD COLUMN "tenant_id" uuid;';
    const table = 'CREATE TABLE "memberships" ("user_id" uuid);';
    const foreign =
      'ALTER TABLE "memberships" ADD CONSTRAINT "fk" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id");';
    const unique = 'ALTER TABLE "users" ADD CONSTRAINT "uq" UNIQUE("tenant_id", "id");';
    const policy = 'CREATE POLICY "isolation" ON "memberships" USING (true);';
    expect(orderMigrationConstraints([column, table, foreign, unique, policy])).toEqual([
      column,
      table,
      unique,
      foreign,
      policy,
    ]);
    expect(orderMigrationConstraints([column, table, unique, foreign, policy])).toEqual([
      column,
      table,
      unique,
      foreign,
      policy,
    ]);
  });
  it('keeps migrations without late unique constraints intact', () => {
    const original = ['CREATE TABLE "a" ("id" uuid PRIMARY KEY);', 'CREATE INDEX "a_id_idx" ON "a" ("id");'];
    expect(orderMigrationConstraints(original)).toEqual(original);
    expect(original).toHaveLength(2);
  });
});
