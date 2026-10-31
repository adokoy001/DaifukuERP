// API keys (docs/specs/machine-credentials.md "HTTP 契約"): list, issue, revoke and history for tenant administrators.
// No business logic: the kernel checks the tenant administrator's own session and the step-up on every call.
// API keys themselves never reach these routes (auth.ts HUMAN_ONLY answers 403 first).
import {
  issueMachineCredential,
  issueMachineCredentialSchema,
  listMachineCredentials,
  machineCredentialAudit,
  revokeMachineCredential,
  revokeMachineCredentialSchema,
  type Database,
} from '@daifuku/kernel';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, withRequestContext } from '../request-context.ts';
import { passthroughValidator } from './actions.ts';

const idParams = z.object({ id: z.uuid() });

export function registerMachineCredentialRoutes(app: FastifyInstance, opts: { db: Database }): void {
  app.get(
    '/admin/tokens',
    { schema: { tags: ['access'], summary: 'API keys of the tenant (secrets and hashes are never returned)' } },
    (req) => withRequestContext(opts.db, req, listMachineCredentials),
  );
  app.post(
    '/admin/tokens',
    {
      schema: {
        tags: ['access'],
        summary: 'Issue an API key after a step-up; the secret is in this response only',
        body: issueMachineCredentialSchema,
      },
      validatorCompiler: passthroughValidator,
    },
    (req) => withRequestContext(opts.db, req, (ctx) => issueMachineCredential(ctx, req.body)),
  );
  app.post(
    '/admin/tokens/:id/revoke',
    {
      schema: {
        tags: ['access'],
        summary: 'Revoke an API key (idempotent)',
        params: idParams,
        body: revokeMachineCredentialSchema,
      },
      validatorCompiler: passthroughValidator,
    },
    (req) => {
      const { id } = parse(idParams, req.params, 'params');
      return withRequestContext(opts.db, req, (ctx) => revokeMachineCredential(ctx, id, req.body ?? {}));
    },
  );
  app.get(
    '/admin/tokens/:id/audit',
    { schema: { tags: ['access'], summary: 'Issue, revoke and refused-use history of an API key', params: idParams } },
    (req) => {
      const { id } = parse(idParams, req.params, 'params');
      return withRequestContext(opts.db, req, (ctx) => machineCredentialAudit(ctx, id));
    },
  );
}
