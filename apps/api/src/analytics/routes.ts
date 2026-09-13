import { withContext, type Database } from '@daifuku/kernel';
import type { FastifyInstance } from 'fastify';
import { parse, withRequestContext } from '../request-context.ts';
import { analyticsCatalog } from './catalog.ts';
import { analyticsScopeKey, analyticsSnapshot, snapshotInput } from './snapshot.ts';

export function registerAnalyticsRoutes(app: FastifyInstance, opts: { db: Database }): void {
  app.get(
    '/analytics/catalog',
    { schema: { tags: ['analytics'], summary: 'Authorized browser analytics sources, fields and defaults' } },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      return withRequestContext(opts.db, req, async (ctx) => {
        const datasets = analyticsCatalog(ctx);
        return { datasets, scopeKey: analyticsScopeKey(ctx, datasets) };
      });
    },
  );
  app.post(
    '/analytics/snapshot',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Complete bounded read-only snapshot for browser pivoting',
        body: snapshotInput,
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      const input = parse(snapshotInput, req.body, 'body');
      return withContext(opts.db, req.contextParams(), (ctx) => analyticsSnapshot(ctx, input), {
        readOnlySnapshot: true,
      });
    },
  );
}
