// Authentication (spec AC-1, AC-2, AC-7): JWT login, per-request principal reload, ContextParams builder.
// The principal is re-read from the users table on every request so role changes take effect immediately.
import { authenticate, changeOwnPassword, changeOwnPasswordSchema, companyBelongsToTenant, DaifukuError, findCompany, isUuid, loadPrincipal, PermissionDenied, resolveCompanyAccess, revokeOwnSessions, revokeOwnSessionsSchema, selectableCompanies, ValidationError, withContext, type ContextParams, type Database, type Locale, type Logger, type Principal } from '@daifuku/kernel';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../request-context.ts';

export interface JwtClaims {
  sub: string;
  tenantId: string;
  sessionVersion: number;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtClaims;
    user: JwtClaims;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook for authenticated routes. */
    principal: Principal | null;
    /** Company for this request: validated `x-company-id` header, else the user's default. Set by the auth hook. */
    companyId: string | null;
    /** Builds the kernel ContextParams for this request (throws 401 when unauthenticated). */
    contextParams(): ContextParams;
  }
}

/** Paths that do not require a token. */
const PUBLIC_PREFIXES = ['/auth/login', '/openapi.json', '/docs', '/health'];

export const TOKEN_TTL = '12h';

export class Unauthorized extends DaifukuError {
  constructor(message: string) {
    super('PERMISSION_DENIED', message, 'Log in with POST /auth/login and send `Authorization: Bearer <token>`.', undefined, 401);
    this.name = 'Unauthorized';
  }
}

const loginBody = z.object({ email: z.string().min(1).max(200), password: z.string().min(1).max(200), tenantId: z.uuid().optional() });

export function publicUser(p: Principal) {
  return { id: p.userId, name: p.name, email: p.email, roles: p.roles, tenantId: p.tenantId, defaultCompanyId: p.defaultCompanyId, tenantAdmin: p.tenantAdmin, accessScope: p.accessScope, storeIds: p.storeIds, siteIds: p.siteIds };
}

function isPublic(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

function localeOf(header: string | undefined): Locale {
  return header?.trim().toLowerCase().startsWith('en') ? 'en' : 'ja';
}

function headerString(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function requestLogger(req: FastifyRequest): Logger {
  return {
    info: (msg, data) => req.log.info({ ...data }, msg),
    warn: (msg, data) => req.log.warn({ ...data }, msg),
    error: (msg, data) => req.log.error({ ...data }, msg),
  };
}

const COMPANY_HINT = 'Send the id of a company in your tenant, or omit the header to use your default company.';

/** Company from `x-company-id` (must exist in the caller's tenant) or the user's default company. */
function resolveCompany(req: FastifyRequest, principal: Principal): string | null {
  const header = headerString(req, 'x-company-id') ?? principal.defaultCompanyId;
  if (header === null) return null;
  if (!isUuid(header)) throw new ValidationError('x-company-id must be a uuid', [{ path: 'headers.x-company-id', message: 'invalid uuid' }], COMPANY_HINT);
  return header;
}

/** ContextParams from the request (AC-2, AC-7). */
export function buildContextParams(req: FastifyRequest): ContextParams {
  const p = req.principal;
  if (!p) throw new Unauthorized('authentication required');
  const agentId = headerString(req, 'x-agent-id');
  return {
    tenantId: p.tenantId,
    companyId: req.companyId,
    actor: agentId ? { type: 'agent', id: agentId, onBehalfOf: p.userId } : { type: 'user', id: p.userId },
    roles: p.roles,
    tenantAdmin: p.tenantAdmin,
    accessScope: p.accessScope,
    storeIds: p.storeIds,
    siteIds: p.siteIds,
    requestId: req.id,
    locale: localeOf(headerString(req, 'accept-language')),
    log: requestLogger(req),
  };
}

async function verifyRequest(req: FastifyRequest, owner: Database): Promise<Principal> {
  let claims: JwtClaims;
  try {
    claims = await req.jwtVerify<JwtClaims>();
  } catch (e) {
    throw new Unauthorized(e instanceof Error ? e.message : 'invalid token');
  }
  if (typeof claims.sub !== 'string' || typeof claims.tenantId !== 'string') throw new Unauthorized('malformed token payload');
  const principal = await loadPrincipal(owner, claims.sub);
  if (!principal || principal.tenantId !== claims.tenantId || principal.sessionVersion !== claims.sessionVersion) throw new Unauthorized('user is inactive, unknown, or the session was revoked');
  return principal;
}

/** `/auth/me` company (kernel-phase15 AC-11): what apps need for display (currency); settings stay behind /meta/settings. */
export interface PublicCompany {
  id: string;
  name: string;
  currency: string;
}

export async function registerAuth(app: FastifyInstance, opts: { owner: Database; db: Database; jwtSecret: string }): Promise<void> {
  await app.register(fastifyJwt, { secret: opts.jwtSecret, sign: { expiresIn: TOKEN_TTL } });
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.headers.authorization || req.url.startsWith('/auth/')) reply.header('cache-control', 'private, no-store');
    return payload;
  });
  app.decorateRequest('principal', null);
  app.decorateRequest('companyId', null);
  app.decorateRequest('contextParams', function (this: FastifyRequest) {
    return buildContextParams(this);
  });

  app.addHook('onRequest', async (req) => {
    if (isPublic(req.url)) return;
    req.principal = await verifyRequest(req, opts.owner);
    // Account security belongs to the authenticated tenant identity, even with no company or a stale selection.
    if (['/auth/password', '/auth/logout-all'].includes(req.url.split('?')[0] ?? req.url)) return;
    req.companyId = resolveCompany(req, req.principal);
    try { req.principal = await resolveCompanyAccess(opts.owner, req.principal, req.companyId); }
    catch (error) {
      if (req.url.split('?')[0] !== '/auth/companies' || !(error instanceof PermissionDenied)) throw error;
      // Recovery is for a stale membership in this tenant, never for an invalid company identity.
      if (!req.companyId || !(await companyBelongsToTenant(opts.owner, req.principal.tenantId, req.companyId))) {
        throw new ValidationError('x-company-id is not a company in your tenant', [{ path: 'headers.x-company-id', message: 'unknown company' }], COMPANY_HINT);
      }
      req.companyId = req.principal.defaultCompanyId;
      req.principal = await resolveCompanyAccess(opts.owner, req.principal, req.companyId);
    }
  });

  app.post('/auth/login', { schema: { tags: ['auth'], summary: 'Log in and receive a JWT (12h)', body: loginBody } }, async (req) => {
    const { email, password, tenantId } = parse(loginBody, req.body, 'body');
    const principal = await authenticate(opts.owner, email, password, tenantId);
    if (!principal) throw new Unauthorized('invalid email or password');
    const token = app.jwt.sign({ sub: principal.userId, tenantId: principal.tenantId, sessionVersion: principal.sessionVersion });
    return { token, user: publicUser(principal) };
  });

  app.post('/auth/password', { schema: { tags: ['auth'], summary: 'Change own password and revoke all sessions', body: changeOwnPasswordSchema } }, async (req) => {
    if (!req.principal) throw new Unauthorized('authentication required');
    const sessionVersion = req.principal.sessionVersion;
    return withContext(opts.db, req.contextParams(), (ctx) => changeOwnPassword(ctx, sessionVersion, req.body));
  });

  app.post('/auth/logout-all', { schema: { tags: ['auth'], summary: 'Revoke all sessions for the current user', body: revokeOwnSessionsSchema } }, async (req) => {
    if (!req.principal) throw new Unauthorized('authentication required');
    const sessionVersion = req.principal.sessionVersion;
    return withContext(opts.db, req.contextParams(), (ctx) => revokeOwnSessions(ctx, sessionVersion, req.body));
  });

  app.get('/auth/me', { schema: { tags: ['auth'], summary: 'Current user, roles, effective context and company (id, name, currency; null without one)' } }, async (req) => {
    const params = req.contextParams();
    if (!req.principal) throw new Unauthorized('authentication required');
    // read in a request context (RLS), like every other company read; null when the request has no company
    const found = await withContext(opts.db, params, (ctx) => findCompany(ctx));
    const company: PublicCompany | null = found ? { id: found.id, name: found.name, currency: found.currency } : null;
    return { user: publicUser(req.principal), companyId: params.companyId, company, actor: params.actor, locale: params.locale };
  });

  app.get('/auth/companies', { schema: { tags: ['auth'], summary: 'Companies selectable in the authenticated tenant' } }, async (req) => {
    if (!req.principal) throw new Unauthorized('authentication required');
    const items = await selectableCompanies(opts.owner, req.principal);
    return { items, companyId: req.companyId };
  });
}
