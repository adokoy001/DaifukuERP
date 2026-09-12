// AC-1: log the configured user in (owner connection, login only) and derive the agent's ContextParams.
import { authenticate, DaifukuError, isUuid, loadPrincipal, resolveCompanyAccess, type ContextParams, type Database, type Logger, type Principal } from '@daifuku/kernel';

export interface AgentLogin {
  email: string;
  password: string;
  agentId: string;
  companyId: string | undefined;
  tenantId?: string | undefined;
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
  if (!principal || principal.tenantId !== params.tenantId || params.sessionVersion !== principal.sessionVersion) throw inactiveSession();
  const access = await checkCompany(owner, principal, params.companyId);
  return { ...params, roles: access.roles, tenantAdmin: access.tenantAdmin, accessScope: access.accessScope, storeIds: access.storeIds, siteIds: access.siteIds };
}

/**
 * Authenticates with the owner connection and returns the params every tool call will run with:
 * actor is the agent (`type: 'agent'`) acting on behalf of the user, with the user's roles and tenant.
 * Returns null when the credentials are rejected (the caller decides how to report it).
 */
export async function openAgentSession(owner: Database, login: AgentLogin, log: Logger): Promise<AgentSession | null> {
  const principal = await authenticate(owner, login.email, login.password, login.tenantId);
  if (!principal) return null;
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
      log,
    },
    user: { id: principal.userId, name: principal.name, email: principal.email },
  };
}
