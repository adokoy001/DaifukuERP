import { beforeAll, afterAll, it, expect } from 'vitest';
import { setTimeout } from 'node:timers/promises';
import { and, eq, sql } from 'drizzle-orm';
import { freshDb, type TestDb } from '../src/testing.ts';
import { companyMemberships, users } from '../src/db/system-tables.ts';
import { newId } from '../src/ids.ts';
import { withRelayOperator } from '../src/relay-auth.ts';
let db: TestDb;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db.close();
});
it('does not hold the user row while waiting for a membership being removed', async () => {
  const userId = newId(),
    gatewayId = newId(),
    application = 'relay-lock-' + newId();
  await db.owner.drizzle.insert(users).values({
    id: userId,
    tenantId: db.tenantId,
    email: userId + '@example.com',
    name: 'Synthetic relay operator',
    defaultCompanyId: db.companyId,
  });
  await db.owner.drizzle
    .insert(companyMemberships)
    .values({ tenantId: db.tenantId, userId, companyId: db.companyId, roles: ['edge_manager'] });
  let worker: Promise<string> | undefined;
  await db.run({}, async (holder) => {
    await holder.db
      .select()
      .from(companyMemberships)
      .where(and(eq(companyMemberships.userId, userId), eq(companyMemberships.companyId, db.companyId)))
      .for('update');
    worker = db.run(
      { actor: { type: 'user', id: userId }, roles: ['edge_manager'], sessionVersion: 1 },
      async (ctx) => {
        await ctx.db.execute(sql`select set_config('application_name', ${application}, true)`);
        return withRelayOperator(ctx, gatewayId, async () => 'authorized');
      },
    );
    // Wait for the actual PostgreSQL lock dependency, not a guessed thread scheduling delay.
    const deadline = Date.now() + 5000;
    let waiting = false;
    while (Date.now() < deadline) {
      const rows = await db.app
        .sql`select pid from pg_stat_activity where application_name = ${application} and wait_event_type = 'Lock'`;
      if (rows.length) {
        waiting = true;
        break;
      }
      await setTimeout(10);
    }
    expect(waiting).toBe(true);
    // The access-admin membership removal path next changes this user's default company.
    // Before the fix the operator already held FOR UPDATE here, producing a lock inversion.
    await holder.db.select().from(users).where(eq(users.id, userId)).for('update', { noWait: true });
  });
  expect(await worker).toBe('authorized');
});
