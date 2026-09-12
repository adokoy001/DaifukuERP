import { and, eq, isNull, lt, lte, or } from 'drizzle-orm';
import type { Context } from '../context.ts';
import type { Database } from '../db/client.ts';
import { identityMail } from '../db/identity-tables.ts';
import { newId } from '../ids.ts';
import { seal, unseal } from './crypto.ts';
export interface IdentityMailPayload { to: string; subject: string; text: string }
export interface IdentityMailTransport { send(message: IdentityMailPayload & { messageId: string }): Promise<void> }
export async function queueIdentityMail(ctx: Context, key: string, message: IdentityMailPayload, expiresAt: Date): Promise<string> {
  const id = newId();
  await ctx.db.insert(identityMail).values({ id, tenantId: ctx.tenantId, payloadCipher: seal(JSON.stringify(message), key, `${ctx.tenantId}:${id}:mail`), expiresAt, nextAttemptAt: ctx.now() });
  return id;
}
/** Lease + fixed message id. SMTP can acknowledge and disconnect before commit: delivery is at-least-once. */
export async function deliverIdentityMail(owner: Database, key: string, transport: IdentityMailTransport | undefined, limit = 20, now = new Date()) {
  if (!transport) return { sent: 0, failed: 0, configured: false };
  let sent = 0, failed = 0;
  for (let index = 0; index < Math.max(0, Math.min(100, limit)); index++) {
    const claimed = await owner.drizzle.transaction(async (tx) => {
      const [row] = await tx.select().from(identityMail).where(and(or(eq(identityMail.status, 'pending'), eq(identityMail.status, 'retry')), lte(identityMail.nextAttemptAt, now), or(isNull(identityMail.leaseUntil), lt(identityMail.leaseUntil, now)))).orderBy(identityMail.createdAt).limit(1).for('update', { skipLocked: true });
      if (!row) return null;
      if (row.expiresAt <= now || row.attempts >= 5) { await tx.update(identityMail).set({ status: 'failed', lastError: row.expiresAt <= now ? 'expired' : 'attempt_limit', payloadCipher: '' }).where(eq(identityMail.id, row.id)); return { skipped: true as const }; }
      const leaseId = newId();
      await tx.update(identityMail).set({ leaseId, leaseUntil: new Date(now.getTime() + 120000), attempts: row.attempts + 1 }).where(eq(identityMail.id, row.id));
      return { ...row, leaseId, skipped: false as const };
    });
    if (!claimed) break;
    if (claimed.skipped) { failed++; continue; }
    try {
      const payload = JSON.parse(unseal(claimed.payloadCipher, key, `${claimed.tenantId}:${claimed.id}:mail`)) as IdentityMailPayload;
      await transport.send({ ...payload, messageId: `<${claimed.id}@daifuku.identity>` });
      await owner.drizzle.update(identityMail).set({ status: 'delivered', deliveredAt: new Date(), leaseUntil: null, leaseId: null, lastError: null, payloadCipher: '' }).where(and(eq(identityMail.id, claimed.id), eq(identityMail.leaseId, claimed.leaseId)));
      sent++;
    } catch {
      await owner.drizzle.update(identityMail).set({ status: claimed.attempts + 1 >= 5 ? 'failed' : 'retry', nextAttemptAt: new Date(now.getTime() + Math.min(3600, 60 * 2 ** claimed.attempts) * 1000), leaseUntil: null, leaseId: null, lastError: 'delivery_failed', ...(claimed.attempts + 1 >= 5 ? { payloadCipher: '' } : {}) }).where(and(eq(identityMail.id, claimed.id), eq(identityMail.leaseId, claimed.leaseId)));
      failed++;
    }
  }
  return { sent, failed, configured: true };
}
