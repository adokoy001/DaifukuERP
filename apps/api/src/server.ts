// Fastify server assembled from plugins and registry-driven routes (docs/specs/api-app.md). No business logic.
import './modules.ts';
import { registerRelayRoutes } from './edge/routes.ts';
import { newId, type Database } from '@daifuku/kernel';
import fastifyCors from '@fastify/cors';
import fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { validateIdentityOptions, type IdentityOptions } from './identity/config.ts';
import { registerAuth } from './plugins/auth.ts';
import { registerErrorHandler } from './plugins/errors.ts';
import { registerOpenApi } from './plugins/openapi.ts';
import { registerRequestLog } from './plugins/request-log.ts';
import { registerActionRoutes } from './routes/actions.ts';
import { registerMetaRoutes } from './routes/meta.ts';
import { registerRestRoutes } from './routes/rest.ts';
import { registerAttachmentRoutes } from './routes/attachments.ts';
import { registerAccessAdminRoutes } from './routes/access-admin.ts';
import type { SquareConnection } from './adapters/square-pos.ts';
import { registerSquarePosRoutes } from './routes/square-pos.ts';
import { registerWorkforceEvidenceRoutes } from './routes/workforce-evidence.ts';
import { registerAnalyticsRoutes } from './analytics/routes.ts';

export interface ServerOptions {
  /** Owner connection: login lookups and principal reloads only (ADR-0004). */
  owner: Database;
  /** App connection: every request context (RLS enforced). */
  app: Database;
  jwtSecret: string;
  trustedProxies?: readonly string[];
  readiness?: () => Promise<{ ready: boolean }>;
  identity?: IdentityOptions;
  squarePosConnections?: SquareConnection[];
  /** Exact browser origins. Omitted means same-origin only; main passes validated environment policy. */
  corsOrigins?: readonly string[];
  logger?: FastifyServerOptions['logger'];
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  if (opts.identity) validateIdentityOptions(opts.identity);
  const server = fastify({
    logger: opts.logger ?? false,
    trustProxy: opts.trustedProxies?.length ? [...opts.trustedProxies] : false,
    // AC-8: request-log.ts writes the single per-request line; Fastify's own incoming/completed lines are off.
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: 'requestId' }),
    requestIdHeader: 'x-request-id',
    genReqId: () => newId(),
  });
  server.setValidatorCompiler(validatorCompiler);
  // Response schemas exist for OpenAPI only; action outputs are already validated by runAction.
  server.setSerializerCompiler(() => (data) => JSON.stringify(data));
  registerErrorHandler(server);
  registerRequestLog(server);
  // @fastify/cors v11 defaults to GET,HEAD,POST only; PATCH/DELETE preflights failed until listed (found by e2e, 2026-09-10).
  await server.register(fastifyCors, { origin: opts.corsOrigins?.length ? [...opts.corsOrigins] : false, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['authorization', 'content-type', 'x-company-id', 'x-agent-id', 'accept-language'] });
  await registerOpenApi(server);
  await registerAuth(server, { owner: opts.owner, db: opts.app, jwtSecret: opts.jwtSecret, ...(opts.identity ? { identity: opts.identity } : {}) });
  server.get('/ready', { schema: { hide: true } }, async (_req, reply) => { const result = await (opts.readiness?.() ?? Promise.resolve({ ready: false })); return reply.code(result.ready ? 200 : 503).send(result); });
  await registerRelayRoutes(server, opts);
  server.get('/health', { schema: { hide: true } }, async () => ({ ok: true }));
  registerMetaRoutes(server, { db: opts.app });
  registerActionRoutes(server, { db: opts.app });
  registerRestRoutes(server, { db: opts.app });
  registerAttachmentRoutes(server, { db: opts.app });
  registerAccessAdminRoutes(server, { db: opts.app });
  registerWorkforceEvidenceRoutes(server, { db: opts.app });
  registerAnalyticsRoutes(server, { db: opts.app });
  await registerSquarePosRoutes(server, { app: opts.app, owner: opts.owner, ...(opts.squarePosConnections ? { connections: opts.squarePosConnections } : {}) });
  return server;
}
