import {
  beginMfaLogin,
  identityDenied,
  loadPrincipal,
  withContext,
  type Database,
  type IdentitySession,
} from '@daifuku/kernel';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { publicUser } from './public-user.ts';
import type { IdentityOptions } from './config.ts';
export interface IdentityRouteOptions {
  owner: Database;
  db: Database;
  identity?: IdentityOptions;
}
export function configured(options: IdentityRouteOptions): IdentityOptions {
  if (!options.identity) throw identityDenied();
  return options.identity;
}
export function currentIdentity(request: FastifyRequest): IdentitySession {
  if (!request.principal) throw identityDenied();
  return {
    userId: request.principal.userId,
    tenantId: request.principal.tenantId,
    sessionVersion: request.principal.sessionVersion,
  };
}
export async function identityLoginReply(
  app: FastifyInstance,
  options: IdentityRouteOptions,
  identity: IdentitySession,
  mfaVerified = false,
) {
  const principal = await loadPrincipal(options.owner, identity.userId);
  if (!principal || principal.tenantId !== identity.tenantId || principal.sessionVersion !== identity.sessionVersion)
    throw identityDenied();
  if (principal.mfaEnabled && !mfaVerified) {
    configured(options);
    return withContext(
      options.db,
      { tenantId: identity.tenantId, companyId: null, actor: { type: 'user', id: identity.userId }, roles: [] },
      (ctx) => beginMfaLogin(ctx, identity),
    );
  }
  const token = app.jwt.sign({
    sub: principal.userId,
    tenantId: principal.tenantId,
    sessionVersion: principal.sessionVersion,
    ...(mfaVerified ? { mfa: true } : {}),
  });
  return { token, user: publicUser(principal) };
}
