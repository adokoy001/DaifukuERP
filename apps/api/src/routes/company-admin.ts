// Company administration (docs/specs/company-admin.md AC-1..AC-5, ADR-0029). The kernel checks the tenant administrator
// on every call; module seeds use the same runtime module list as setup and db:reset.
import {
  createCompany,
  createCompanySchema,
  listCompanies,
  updateCompany,
  updateCompanySchema,
  type Database,
} from '@daifuku/kernel';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { modules } from '../modules.ts';
import { parse, withRequestContext } from '../request-context.ts';
import { passthroughValidator } from './actions.ts';

const companyParams = z.object({ id: z.uuid() });

export function registerCompanyAdminRoutes(app: FastifyInstance, opts: { db: Database }): void {
  app.get(
    '/admin/companies',
    { schema: { tags: ['access'], summary: 'Companies of the tenant (tenant administrators)' } },
    (req) => withRequestContext(opts.db, req, listCompanies),
  );
  app.post(
    '/admin/companies',
    {
      schema: {
        tags: ['access'],
        summary: 'Create a company with the creator as admin and every module seed (tenant administrators)',
        body: createCompanySchema,
      },
      validatorCompiler: passthroughValidator,
    },
    (req) => withRequestContext(opts.db, req, (ctx) => createCompany(ctx, req.body, { modules })),
  );
  app.patch(
    '/admin/companies/:id',
    {
      schema: {
        tags: ['access'],
        summary: 'Rename a company or change its country; code and currency are immutable (tenant administrators)',
        params: companyParams,
        body: updateCompanySchema,
      },
      validatorCompiler: passthroughValidator,
    },
    (req) => {
      const { id } = parse(companyParams, req.params, 'params');
      return withRequestContext(opts.db, req, (ctx) => updateCompany(ctx, id, req.body));
    },
  );
}
