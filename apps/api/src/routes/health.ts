// GET /meta/health (docs/specs/setup-health.md AC-1..AC-8): the setup health report of the request's company. The
// kernel checks the caller (admin or settings, company-wide) and runs the kernel and module checks; this route adds the
// platform items only the API knows (apps/api/src/health.ts). Not the liveness probe GET /health.
import { runHealthChecks, type Database } from '@daifuku/kernel';
import type { FastifyInstance } from 'fastify';
import { platformHealthChecks, type PlatformHealthOptions } from '../health.ts';
import { withRequestContext } from '../request-context.ts';

export function registerHealthRoutes(
  app: FastifyInstance,
  opts: { db: Database; platform: PlatformHealthOptions },
): void {
  const platform = platformHealthChecks(opts.platform);
  app.get(
    '/meta/health',
    {
      schema: {
        tags: ['meta'],
        summary: 'Setup health of the current company: status, label, detail and fix link per item (admin or settings)',
      },
    },
    // Checks only read (the spec puts fixing out of scope): a read-only transaction makes a check that tries to write
    // fail, and runHealthChecks reports it as a warn item (ADR-0027 §7).
    (req) => withRequestContext(opts.db, req, (ctx) => runHealthChecks(ctx, platform), { readOnlySnapshot: true }),
  );
}
