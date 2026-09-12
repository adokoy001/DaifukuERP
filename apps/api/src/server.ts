// Fastify server assembled from plugins and registry-driven routes (docs/specs/api-app.md). No business logic.
import './modules.ts';
import { newId, type Database } from '@daifuku/kernel';
import fastifyCors from '@fastify/cors';
import fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { registerAuth } from './plugins/auth.ts';
import { registerErrorHandler } from './plugins/errors.ts';
import { registerOpenApi } from './plugins/openapi.ts';
import { registerRequestLog } from './plugins/request-log.ts';
import { registerActionRoutes } from './routes/actions.ts';
import { registerMetaRoutes } from './routes/meta.ts';
import { registerRestRoutes } from './routes/rest.ts';
import { registerAttachmentRoutes } from './routes/attachments.ts';
import { registerAccessAdminRoutes } from './routes/access-admin.ts';
import { registerWorkforceEvidenceRoutes } from './routes/workforce-evidence.ts';

export interface ServerOptions {
  /** Owner connection: login lookups and principal reloads only (ADR-0004). */
  owner: Database;
  /** App connection: every request context (RLS enforced). */
  app: Database;
  jwtSecret: string;
  /** Exact browser origins. Omitted means same-origin only; main passes validated environment policy. */
  corsOrigins?: readonly string[];
  logger?: FastifyServerOptions['logger'];
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const server = fastify({
    logger: opts.logger ?? false,
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
  await registerAuth(server, { owner: opts.owner, db: opts.app, jwtSecret: opts.jwtSecret });
  server.get('/health', { schema: { hide: true } }, async () => ({ ok: true }));
  registerMetaRoutes(server, { db: opts.app });
  registerActionRoutes(server, { db: opts.app });
  registerRestRoutes(server, { db: opts.app });
  registerAttachmentRoutes(server, { db: opts.app });
  registerAccessAdminRoutes(server, { db: opts.app });
  registerWorkforceEvidenceRoutes(server, { db: opts.app });
  return server;
}
