// AC-1: log the configured user in (owner connection, login only) and derive the agent's ContextParams.
import { authenticate, identityDenied, withIdentityAttempt, lockIdentity, verifyFactor, withContext, DaifukuError, isUuid, loadPrincipal, resolveCompanyAccess, type ContextParams, type Database, type Logger, type Principal } from '@daifuku/kernel';

export interface AgentLogin {
  email: string;
  password: string;
  agentId: string;
  companyId: string | undefined;
  tenantId?: string | undefined;
  mfaCode?: string | undefined;
  identityEncryptionKey?: string | undefined;
}

export interface AgentSession {
  params: ContextParams;
  user: { id: string; name: string; email: string };
}

function inactiveSession(): DaifukuError {
  return new DaifukuError('PERMISSION_DENIED', 'The user or company is inactive, unknown, or outside this session.', 'Reconnect with an active user and a company in the same tenant.', undefined, 401);
}

async function checkCompany(owner: Database, principal: Principal, companyId: string | null): Promise<Principal> {
  if (companyId !== null && !isUuid(companyId)) throw inactiveSession();
  return resolveCompanyAccess(owner, principal, companyId);
}

/** The session stores identity; current authorization is resolved for every operation. */
export async function refreshAgentContext(owner: Database, params: ContextParams): Promise<ContextParams> {
  const userId = params.actor.type === 'agent' ? params.actor.onBehalfOf : params.actor.id;
  if (!userId || params.actor.type === 'system') throw inactiveSession();
  const principal = await loadPrincipal(owner, userId);
  if (!principal || principal.tenantId !== params.tenantId || params.sessionVersion !== principal.sessionVersion || (principal.mfaEnabled && params.mfaVerified !== true)) throw inactiveSession();
  const access = await checkCompany(owner, principal, params.companyId);
  return { ...params, roles: access.roles, tenantAdmin: access.tenantAdmin, accessScope: access.accessScope, storeIds: access.storeIds, siteIds: access.siteIds };
}

/**
 * Authenticates with the owner connection and returns the params every tool call will run with:
 * actor is the agent (`type: 'agent'`) acting on behalf of the user, with the user's roles and tenant.
 * Returns null when the credentials are rejected (the caller decides how to report it).
 */
export async function openAgentSession(owner: Database, login: AgentLogin, log: Logger): Promise<AgentSession | null> {
  let principal: Principal;
  try {
    principal = await withIdentityAttempt(owner, [{ key: `verify-identity:login:${login.tenantId ?? ''}:${login.email.toLowerCase()}`, limit: 10 }], async () => {
      const found = await authenticate(owner, login.email, login.password, login.tenantId);
      if (!found) throw identityDenied();
      return found;
    });
    if (principal.mfaEnabled) await withIdentityAttempt(owner, [{ key: `factor:${principal.tenantId}:${principal.userId}`, limit: 10 }], async () => {
      if (!login.mfaCode || !login.identityEncryptionKey) throw identityDenied();
      await withContext(owner, { tenantId: principal.tenantId, companyId: null, actor: { type: 'user', id: principal.userId }, roles: [] }, async (ctx) => {
        const user = await lockIdentity(ctx, principal.sessionVersion); await verifyFactor(ctx, user, login.mfaCode ?? '', login.identityEncryptionKey ?? '');
      });
    });
  } catch (error) {
    if (error instanceof DaifukuError && [400, 401].includes(error.httpStatus)) return null;
    throw error;
  }
  const companyId = login.companyId ?? principal.defaultCompanyId;
  const access = await checkCompany(owner, principal, companyId);
  if (companyId === null) log.warn('user has no default company; running at tenant level (companyId=null)', { user: principal.userId });
  return {
    params: {
      tenantId: principal.tenantId,
      companyId,
      actor: { type: 'agent', id: login.agentId, onBehalfOf: principal.userId },
      roles: access.roles,
      tenantAdmin: access.tenantAdmin,
      accessScope: access.accessScope,
      storeIds: access.storeIds,
      siteIds: access.siteIds,
      sessionVersion: access.sessionVersion,
      mfaVerified: principal.mfaEnabled === true,
      log,
    },
    user: { id: principal.userId, name: principal.name, email: principal.email },
  };
}
