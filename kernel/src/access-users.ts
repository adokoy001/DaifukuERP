import { and, eq, sql } from 'drizzle-orm';
import { hashPassword } from './auth.ts';
import {
  actorUser,
  assertAccessAdmin,
  assertAccessVersion,
  createUserSchema,
  managedUser,
  parseAccess,
  publicManagedUser,
  updateUserSchema,
  writeAccessAudit,
} from './access-admin-common.ts';
import type { Context } from './context.ts';
import { users } from './db/system-tables.ts';
import { Conflict, PermissionDenied, StateError } from './errors.ts';
import { newId } from './ids.ts';

export async function createManagedUser(ctx: Context, raw: unknown) {
  await assertAccessAdmin(ctx, true);
  const input = parseAccess(createUserSchema, raw);
  const email = input.email.toLowerCase();
  const found = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, ctx.tenantId), eq(users.email, email)))
    .limit(1);
  if (found.length)
    throw new Conflict('A user with this email already exists', 'Edit the existing user or choose another email.');
  const [row] = await ctx.db
    .insert(users)
    .values({
      id: newId(),
      tenantId: ctx.tenantId,
      email,
      name: input.name,
      passwordHash: hashPassword(input.password),
      tenantAdmin: input.tenantAdmin ? 1 : 0,
      roles: [],
    })
    .returning();
  if (!row) throw new StateError('User was not created', 'Retry the operation.');
  const result = publicManagedUser(row);
  await writeAccessAudit(ctx, null, 'access_user', row.id, 'create', null, result);
  return result;
}

export async function updateManagedUser(ctx: Context, id: string, raw: unknown) {
  await assertAccessAdmin(ctx, true);
  const input = parseAccess(updateUserSchema, raw);
  const before = await managedUser(ctx, id);
  assertAccessVersion(before.version, input.expectedVersion);
  if (
    id === actorUser(ctx) &&
    (input.active === false || (input.tenantAdmin !== undefined && input.tenantAdmin !== (before.tenantAdmin === 1)))
  )
    throw new PermissionDenied('access_user', 'self-access-change', ctx.roles);
  const active = input.active === undefined ? before.active : input.active ? 1 : 0;
  const tenantAdmin = input.tenantAdmin === undefined ? before.tenantAdmin : input.tenantAdmin ? 1 : 0;
  if (before.active === 1 && before.tenantAdmin === 1 && (active !== 1 || tenantAdmin !== 1)) {
    const others = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.tenantId, ctx.tenantId), eq(users.active, 1), eq(users.tenantAdmin, 1), sql`${users.id} <> ${id}`),
      );
    if (!others.length)
      throw new StateError(
        'The last active tenant administrator cannot be removed',
        'Create another active tenant administrator first.',
      );
  }
  const sessionChanged = input.password !== undefined || active !== before.active || tenantAdmin !== before.tenantAdmin;
  const [after] = await ctx.db
    .update(users)
    .set({
      name: input.name ?? before.name,
      active,
      tenantAdmin,
      version: before.version + 1,
      sessionVersion: before.sessionVersion + (sessionChanged ? 1 : 0),
      ...(input.password ? { passwordHash: hashPassword(input.password) } : {}),
    })
    .where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, id), eq(users.version, before.version)))
    .returning();
  if (!after) throw new Conflict('User was changed concurrently', 'Reload before saving.');
  await writeAccessAudit(ctx, null, 'access_user', id, 'update', publicManagedUser(before), {
    ...publicManagedUser(after),
    passwordChanged: input.password !== undefined,
  });
  return publicManagedUser(after);
}
