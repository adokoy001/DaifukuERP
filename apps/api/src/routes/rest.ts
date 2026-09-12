// Spec AC-5: REST sugar over the generic entity actions (<entity>.list/get/create/update/delete/submit/cancel/amend)
// plus GET /api/:entity/:id/audit. No business logic here; everything delegates to the kernel.
import { auditTrail, registry, repo, ValidationError, type Database } from '@daifuku/kernel';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { callAction, parse, withRequestContext } from '../request-context.ts';
import { unknownEntity } from './meta.ts';
import { passthroughValidator } from './actions.ts';

const entityParams = z.object({ entity: z.string().min(1).max(100) });
const idParams = entityParams.extend({ id: z.uuid() });
const opParams = idParams.extend({ op: z.enum(['submit', 'cancel', 'amend']) });
const documentInput = z.object({ expectedVersion: z.number().int().min(1).optional(), correctionDate: z.iso.date().optional() }).strict();
const listQuery = z.object({
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  /** `field:asc,other:desc` */
  orderBy: z.string().max(200).optional(),
  /** JSON domain expression, e.g. `{"isCustomer":true}` */
  where: z.string().max(4000).optional(),
});

function entityOf(params: unknown): string {
  const { entity } = parse(entityParams, params, 'params');
  if (!registry.hasEntity(entity)) throw unknownEntity(entity);
  return entity;
}

function parseOrderBy(s: string | undefined): { field: string; dir?: 'asc' | 'desc' }[] | undefined {
  if (!s) return undefined;
  return s
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const [field, dir] = part.split(':');
      if (!field || (dir !== undefined && dir !== 'asc' && dir !== 'desc')) {
        throw new ValidationError(`invalid orderBy "${part}"`, [{ path: 'orderBy', message: 'expected field or field:asc|desc' }]);
      }
      return dir ? { field, dir } : { field };
    });
}

function parseWhere(s: string | undefined): unknown {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    throw new ValidationError('where must be a JSON object', [{ path: 'where', message: 'invalid JSON' }], 'Example: where={"isCustomer":true}');
  }
}

export function listInput(query: unknown): Record<string, unknown> {
  const q = parse(listQuery, query, 'query');
  const input: Record<string, unknown> = {};
  if (q.search !== undefined) input.search = q.search;
  if (q.limit !== undefined) input.limit = q.limit;
  if (q.offset !== undefined) input.offset = q.offset;
  const orderBy = parseOrderBy(q.orderBy);
  if (orderBy) input.orderBy = orderBy;
  const where = parseWhere(q.where);
  if (where !== undefined) input.where = where;
  return input;
}

/** PATCH body is either `{ patch, expectedVersion? }` or the patch itself. */
export function updateInput(id: string, body: unknown): Record<string, unknown> {
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    const keys = Object.keys(b);
    const wrapped = 'patch' in b && typeof b.patch === 'object' && b.patch !== null && keys.every((k) => k === 'patch' || k === 'expectedVersion');
    if (wrapped) return { id, patch: b.patch, ...(b.expectedVersion !== undefined ? { expectedVersion: b.expectedVersion } : {}) };
  }
  return { id, patch: body ?? {} };
}

const NO_VALIDATION = { validatorCompiler: passthroughValidator };
const tag = (summary: string) => ({ tags: ['rest'], summary, params: entityParams });
const tagId = (summary: string) => ({ tags: ['rest'], summary, params: idParams });

export function registerRestRoutes(app: FastifyInstance, opts: { db: Database }): void {
  const act = (req: FastifyRequest, name: string, input: unknown) => callAction(opts.db, req, name, input);

  app.get('/api/:entity', { schema: { ...tag('List records (search, limit, offset, orderBy=field:asc, where=<json>)'), querystring: listQuery } }, async (req) =>
    act(req, `${entityOf(req.params)}.list`, listInput(req.query)),
  );
  app.get('/api/:entity/:id', { schema: tagId('Get one record') }, async (req) => {
    const { id } = parse(idParams, req.params, 'params');
    return act(req, `${entityOf(req.params)}.get`, { id });
  });
  app.post('/api/:entity', { schema: tag('Create a record (body = insert input)'), ...NO_VALIDATION }, async (req) => act(req, `${entityOf(req.params)}.create`, req.body));
  app.patch('/api/:entity/:id', { schema: tagId('Update a record (body = patch, or { patch, expectedVersion })'), ...NO_VALIDATION }, async (req) => {
    const { id } = parse(idParams, req.params, 'params');
    return act(req, `${entityOf(req.params)}.update`, updateInput(id, req.body));
  });
  app.delete('/api/:entity/:id', { schema: tagId('Delete a record (documents: drafts only)') }, async (req) => {
    const { id } = parse(idParams, req.params, 'params');
    const body = parse(documentInput.omit({ correctionDate: true }), req.body ?? {}, 'body');
    return act(req, `${entityOf(req.params)}.delete`, { id, ...body });
  });
  app.post('/api/:entity/:id/:op', { schema: { tags: ['rest'], summary: 'Document lifecycle: submit | cancel | amend', params: opParams } }, async (req) => {
    const { id, op } = parse(opParams, req.params, 'params');
    const body = parse(documentInput, req.body ?? {}, 'body');
    return act(req, `${entityOf(req.params)}.${op}`, { id, ...body });
  });
  app.get('/api/:entity/:id/audit', { schema: tagId('Audit trail of a record (newest first)') }, async (req) => {
    const { id } = parse(idParams, req.params, 'params');
    const entity = registry.entity(entityOf(req.params));
    return withRequestContext(opts.db, req, async (ctx) => {
      await repo(ctx, entity).get(id); // permission + visibility check; NotFound if the caller may not see it
      return auditTrail(ctx, entity.name, id);
    });
  });
}
