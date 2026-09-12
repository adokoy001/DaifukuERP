// Spec AC-8: exactly one JSON line per request (Fastify's own request logging is disabled in server.ts).
import type { FastifyInstance, FastifyRequest } from 'fastify';

/** `requestId` is added by the request-bound logger (requestIdLogLabel in server.ts). */
export interface RequestLogLine {
  method: string;
  url: string;
  status: number;
  ms: number;
  actor: { type: 'user' | 'agent' | 'anonymous'; id: string | null; onBehalfOf?: string };
}

function actorOf(req: FastifyRequest): RequestLogLine['actor'] {
  const p = req.principal;
  if (!p) return { type: 'anonymous', id: null };
  const agent = req.headers['x-agent-id'];
  const agentId = Array.isArray(agent) ? agent[0] : agent;
  return agentId ? { type: 'agent', id: agentId, onBehalfOf: p.userId } : { type: 'user', id: p.userId };
}

export function registerRequestLog(app: FastifyInstance): void {
  app.addHook('onResponse', async (req, reply) => {
    const line: RequestLogLine = {
      method: req.method,
      url: req.url.split('?')[0] ?? req.url,
      status: reply.statusCode,
      ms: Math.round(reply.elapsedTime * 1000) / 1000,
      actor: actorOf(req),
    };
    req.log.info(line, 'request');
  });
}
