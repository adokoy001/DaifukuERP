import { DaifukuError, loadPrincipal, PermissionDenied, resolveCompanyAccess, withContext, type Database } from '@daifuku/kernel';
import { receivePosEvent } from '@daifuku/mod-pos-integration';
import type { FastifyInstance } from 'fastify';
import { normalizeSquareEvent, squareConnectionSchema, verifySquareSignature, type SquareConnection } from '../adapters/square-pos.ts';
export interface SquarePosOptions { app: Database; owner: Database; connections?: readonly SquareConnection[] }
/** Public only at this exact POST route: Square signature replaces JWT authentication. */
export async function registerSquarePosRoutes(server: FastifyInstance, options: SquarePosOptions) {
  const connections = (options.connections ?? []).map((connection) => squareConnectionSchema.parse(connection));
  await server.register(async (scope) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 1_048_576 }, (_request, body, done) => done(null, body));
    scope.post<{ Params: { connectionKey: string }; Body: string }>('/webhooks/square/:connectionKey', { schema: { hide: true }, bodyLimit: 1_048_576 }, async (request, reply) => {
      const connection = connections.find((row) => row.key === request.params.connectionKey);
      if (!connection) throw new DaifukuError('INVALID_STATE', 'Square connection is not configured', 'Configure a dedicated integration principal and verified merchant/location mapping.', undefined, 503);
      const signature = request.headers['x-square-hmacsha256-signature'];
      if (typeof request.body !== 'string' || !verifySquareSignature(request.body, typeof signature === 'string' ? signature : undefined, connection)) throw new PermissionDenied('square_webhook', 'signature', []);
      const event = normalizeSquareEvent(request.body);
      if (event.merchantId !== connection.merchantId || (event.locationId !== null && event.locationId !== connection.externalLocationId)) throw new PermissionDenied('square_webhook', 'merchant-location', []);
      const principal = await loadPrincipal(options.owner, connection.userId);
      if (!principal || principal.tenantId !== connection.tenantId) throw new PermissionDenied('square_webhook', 'integration-principal', []);
      const access = await resolveCompanyAccess(options.owner, principal, connection.companyId);
      if (access.accessScope !== 'all') throw new PermissionDenied('square_webhook', 'company-scope', access.roles);
      const result = await withContext(options.app, { tenantId: connection.tenantId, companyId: connection.companyId, actor: { type: 'user', id: principal.userId }, roles: access.roles, tenantAdmin: access.tenantAdmin, accessScope: access.accessScope, sessionVersion: principal.sessionVersion, requestId: String(request.id) }, (ctx) => receivePosEvent(ctx, connection.locationId, event));
      // 202 acknowledges durable receipt, never successful accounting; callers see the explicit inbox state.
      return reply.code(result.status === 'posted' || result.status === 'ignored' ? 200 : 202).send(result);
    });
  });
}
