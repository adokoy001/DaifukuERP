// GET /meta/setup-status (docs/specs/setup-wizard.md AC-5, AC-8, AC-13, AC-14): the setup wizard's steps for the
// request's company, judged from real data. Admin with company-wide access only. Read-only: the whole derivation runs in
// a read-only snapshot, so nothing (not even an audit row) can be written. Saving goes through the existing endpoints.
import type { Database } from '@daifuku/kernel';
import type { FastifyInstance } from 'fastify';
import { withRequestContext } from '../request-context.ts';
import { setupStatus } from '../setup-status.ts';

export function registerSetupStatusRoutes(app: FastifyInstance, opts: { db: Database }): void {
  app.get(
    '/meta/setup-status',
    {
      schema: {
        tags: ['meta'],
        summary:
          'Setup wizard steps of the current company: done / todo / skipped from real data, checks, summary (admin)',
      },
    },
    (req) => withRequestContext(opts.db, req, (ctx) => setupStatus(ctx), { readOnlySnapshot: true }),
  );
}
