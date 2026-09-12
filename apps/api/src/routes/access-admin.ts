import { accessAudit, accessDirectory, createManagedUser, createUserSchema, membershipSchema, putCompanyMembership, removeCompanyMembership, removeMembershipSchema, updateManagedUser, updateUserSchema, type Database } from '@daifuku/kernel';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, withRequestContext } from '../request-context.ts';
import { passthroughValidator } from './actions.ts';

const userParams = z.object({ id: z.uuid() });
const membershipParams = userParams.extend({ companyId: z.uuid() });

export function registerAccessAdminRoutes(app: FastifyInstance, opts: { db: Database }): void {
  app.get('/admin/access', { schema: { tags: ['access'], summary: 'Tenant user and company access directory' } }, (req) => withRequestContext(opts.db, req, accessDirectory));
  app.get('/admin/access/audit', { schema: { tags: ['access'], querystring: z.object({ userId: z.uuid() }) } }, (req) => {
    const { userId } = parse(z.object({ userId: z.uuid() }), req.query, 'query');
    return withRequestContext(opts.db, req, (ctx) => accessAudit(ctx, userId));
  });
  app.post('/admin/users', { schema: { tags: ['access'], body: createUserSchema }, validatorCompiler: passthroughValidator }, (req) => withRequestContext(opts.db, req, (ctx) => createManagedUser(ctx, req.body)));
  app.patch('/admin/users/:id', { schema: { tags: ['access'], params: userParams, body: updateUserSchema }, validatorCompiler: passthroughValidator }, (req) => {
    const { id } = parse(userParams, req.params, 'params');
    return withRequestContext(opts.db, req, (ctx) => updateManagedUser(ctx, id, req.body));
  });
  app.put('/admin/users/:id/companies/:companyId', { schema: { tags: ['access'], params: membershipParams, body: membershipSchema }, validatorCompiler: passthroughValidator }, (req) => {
    const { id, companyId } = parse(membershipParams, req.params, 'params');
    return withRequestContext(opts.db, req, (ctx) => putCompanyMembership(ctx, id, companyId, req.body));
  });
  app.delete('/admin/users/:id/companies/:companyId', { schema: { tags: ['access'], params: membershipParams, body: removeMembershipSchema }, validatorCompiler: passthroughValidator }, (req) => {
    const { id, companyId } = parse(membershipParams, req.params, 'params');
    return withRequestContext(opts.db, req, (ctx) => removeCompanyMembership(ctx, id, companyId, req.body));
  });
}
