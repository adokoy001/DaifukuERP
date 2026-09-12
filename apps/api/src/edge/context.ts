import { authenticateRelay, withContext, withIdentityAttempt, identityRateLimit, DaifukuError, type Database, type Context, type RelayPrincipal } from '@daifuku/kernel';
import { relayWork, EDGE_PROTOCOL_VERSION, EDGE_POLL_MS, EDGE_HEARTBEAT_MS } from '@daifuku/mod-edge-integration';
import type { FastifyRequest } from 'fastify';
export interface EdgeOptions { owner: Database; app: Database }
export function relaySecret(request: FastifyRequest): string {
  // Native agents use a header. Query tokens, cookies and human JWTs are never credentials here.
  if (request.url.includes('?') || request.headers.origin || request.headers['x-company-id'] || request.headers['x-agent-id']) throw new DaifukuError('PERMISSION_DENIED', 'Invalid relay authentication transport', 'Use only the native Authorization bearer header.', undefined, 401);
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '');
  if (!match?.[1]) throw new DaifukuError('PERMISSION_DENIED', 'Relay authentication required', 'Pair this LAN gateway first.', undefined, 401);
  return match[1];
}
export function relayContext<T>(opts: EdgeOptions, principal: RelayPrincipal, fn: (ctx: Context) => Promise<T>) {
  return withContext(opts.app, { tenantId: principal.tenantId, companyId: principal.companyId, actor: { type: 'relay', id: principal.gatewayId }, roles: ['relay'], accessScope: 'all', relay: { credentialId: principal.credentialId, credentialVersion: principal.credentialVersion, gatewayId: principal.gatewayId, siteId: principal.siteId } }, fn);
}
export async function withRelayRequest<T>(opts: EdgeOptions, req: FastifyRequest, fn: (ctx: Context) => Promise<T>) {
  const principal = await withIdentityAttempt(opts.owner, [{ key: 'relay-auth:' + req.ip, limit: 100 }], () => authenticateRelay(opts.owner, relaySecret(req)));
  await identityRateLimit(opts.owner, 'relay-requests:' + principal.tenantId + ':' + principal.gatewayId, 600, 60);
  return relayContext(opts, principal, fn);
}
export function sessionView(principal: RelayPrincipal, now = new Date()) { return { gatewayId: principal.gatewayId, companyId: principal.companyId, siteId: principal.siteId, credentialVersion: principal.credentialVersion, credentialExpiresAt: principal.expiresAt.toISOString(), serverTime: now.toISOString(), protocolVersion: EDGE_PROTOCOL_VERSION, pollAfterMs: EDGE_POLL_MS, heartbeatAfterMs: EDGE_HEARTBEAT_MS }; }
export async function verifiedSocket(opts: EdgeOptions, request: FastifyRequest) {
  const principal = await withIdentityAttempt(opts.owner, [{ key: 'relay-auth:' + request.ip, limit: 100 }], () => authenticateRelay(opts.owner, relaySecret(request)));
  await identityRateLimit(opts.owner, 'relay-sockets:' + principal.tenantId + ':' + principal.gatewayId, 20, 60);
  await relayContext(opts, principal, (ctx) => relayWork(ctx, async () => true)); return principal;
}
