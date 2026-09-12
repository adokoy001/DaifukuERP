// Tenant-level self-service identity operations; no company role or administrator privilege is required.
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { actorUser, parseAccess, writeAccessAudit } from './access-admin-common.ts';
import { hashPassword, verifyPassword } from './auth.ts';
import type { Context } from './context.ts';
import { users } from './db/system-tables.ts';
import { DaifukuError, ValidationError } from './errors.ts';

export const changeOwnPasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(12).max(200) }).strict();
export const revokeOwnSessionsSchema = z.object({}).strict();

function expiredSession(): DaifukuError {
  return new DaifukuError('PERMISSION_DENIED', 'The session is no longer active.', 'Log in again before changing account security.', undefined, 401);
}

/** Row locking orders this operation with administrator resets, deactivation and concurrent sessions. */
async function lockedSelf(ctx: Context, sessionVersion: number) {
  if (ctx.actor.type === 'system') throw expiredSession();
  const [user] = await ctx.db.select().from(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, actorUser(ctx)))).limit(1).for('update');
  if (!user || user.active !== 1 || user.sessionVersion !== sessionVersion) throw expiredSession();
  return user;
}

export async function changeOwnPassword(ctx: Context, sessionVersion: number, raw: unknown): Promise<{ ok: true }> {
  const input = parseAccess(changeOwnPasswordSchema, raw);
  const user = await lockedSelf(ctx, sessionVersion);
  if (!verifyPassword(input.currentPassword, user.passwordHash)) throw new ValidationError('The current password is incorrect.', [{ path: 'currentPassword', message: 'Enter your current password.' }]);
  if (input.currentPassword === input.newPassword) throw new ValidationError('Choose a different password.', [{ path: 'newPassword', message: 'The new password must differ from the current password.' }]);
  await ctx.db.update(users).set({ passwordHash: hashPassword(input.newPassword), version: user.version + 1, sessionVersion: user.sessionVersion + 1 }).where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, user.id)));
  await writeAccessAudit(ctx, null, 'access_user', user.id, 'password_change', null, { passwordChanged: true, sessionsRevoked: true });
  return { ok: true };
}

export async function revokeOwnSessions(ctx: Context, sessionVersion: number, raw: unknown): Promise<{ ok: true }> {
  parseAccess(revokeOwnSessionsSchema, raw);
  const user = await lockedSelf(ctx, sessionVersion);
  await ctx.db.update(users).set({ version: user.version + 1, sessionVersion: user.sessionVersion + 1 }).where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, user.id)));
  await writeAccessAudit(ctx, null, 'access_user', user.id, 'sessions_revoke', null, { sessionsRevoked: true });
  return { ok: true };
}
