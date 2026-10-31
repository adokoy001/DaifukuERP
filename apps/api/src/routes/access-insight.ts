// Access insight (docs/specs/access-insight.md AC-1..AC-17, ADR-0007 addendum): the permission matrix derived from the
// registry and the audit search. The kernel checks the caller (admin with company-wide access, a person or an agent for
// that person) BEFORE it validates the query, so the query is passed through unparsed (AC-11 order: 403, 400, 403, 409).
// Every route runs in a read-only snapshot: nothing here writes, not even an audit of the search (AC-16).
import { auditSearchOptions, permissionMatrix, searchAudit, type Database } from '@daifuku/kernel';
import type { FastifyInstance } from 'fastify';
import { withRequestContext } from '../request-context.ts';
import { passthroughValidator } from './actions.ts';

const readOnly = { readOnlySnapshot: true } as const;

export function registerAccessInsightRoutes(app: FastifyInstance, opts: { db: Database }): void {
  app.get(
    '/admin/permissions',
    {
      schema: {
        tags: ['access'],
        summary: 'Entity x role x operation matrix derived from the registry, with row/field/store notes (admin)',
      },
    },
    (req) => withRequestContext(opts.db, req, async (ctx) => permissionMatrix(ctx), readOnly),
  );
  app.get(
    '/admin/audit',
    {
      schema: {
        tags: ['access'],
        summary:
          'Audit records of the current company (or scope=tenant) by period, user, entity, op and record id, newest first (admin)',
      },
      validatorCompiler: passthroughValidator,
    },
    (req) => withRequestContext(opts.db, req, (ctx) => searchAudit(ctx, req.query), readOnly),
  );
  app.get(
    '/admin/audit/options',
    {
      schema: { tags: ['access'], summary: 'User, subject and operation choices of the audit search (admin)' },
      validatorCompiler: passthroughValidator,
    },
    (req) => withRequestContext(opts.db, req, (ctx) => auditSearchOptions(ctx, req.query), readOnly),
  );
}
