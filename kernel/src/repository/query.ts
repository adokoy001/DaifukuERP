// List query shape and its compilation to Drizzle conditions.
import { and, asc, desc, ilike, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../context.ts';
import type { EntityDef } from '../dsl/entity.ts';
import type { Domain } from '../dsl/types.ts';
import { ValidationError } from '../errors.ts';
import { normalizeText } from '../normalize.ts';
import { assertReadableFields, compileDomain, maskedFields } from '../permissions.ts';
import { extFieldOf, extSearchConditions, isExtPath } from './ext-query.ts';

export interface ListQuery {
  where?: Domain;
  /** Case-insensitive substring match over `views.search` fields (or displayField). */
  search?: string;
  orderBy?: readonly { field: string; dir?: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
}

export const listQuerySchema = z.object({
  where: z.record(z.string(), z.unknown()).optional(),
  search: z.string().max(200).optional(),
  orderBy: z
    .array(z.object({ field: z.string(), dir: z.enum(['asc', 'desc']).optional() }))
    .max(5)
    .optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

export const MAX_LIMIT = 500;
export const DEFAULT_LIMIT = 50;

export function searchCondition(ctx: Context, entity: EntityDef, search: string | undefined): SQL | undefined {
  if (!search) return undefined;
  const fields = entity.config.views?.search ?? (entity.displayField ? [entity.displayField] : []);
  const hidden = maskedFields(ctx, entity);
  const textFields = fields.filter(
    (f) => entity.config.fields[f]?.kind === 'text' && !hidden.has(f) && !entity.config.fields[f]?.opts.outputHidden,
  );
  const escape = (s: string) => s.replace(/[%_]/g, (m) => `\\${m}`);
  const terms = [
    ...textFields.map((f) => {
      const mode = (entity.config.fields[f]?.opts as { normalize?: 'trim' | 'halfwidth-kana' | 'upper' }).normalize;
      return ilike(entity.col(f), `%${escape(mode ? normalizeText(mode, search) : search)}%`);
    }),
    // AC-5 (ADR-0014): registered text ext fields with searchable: true
    ...extSearchConditions(entity, search),
  ];
  return terms.length === 0 ? undefined : or(...terms);
}

export function whereCondition(ctx: Context, entity: EntityDef, where: Domain | undefined): SQL | undefined {
  if (!where) return undefined;
  for (const key of Object.keys(where)) {
    if (key === '$and' || key === '$or') {
      const children = where[key];
      if (!Array.isArray(children))
        throw new ValidationError('invalid where group', [{ path: key, message: 'array required' }]);
      for (const child of children) whereCondition(ctx, entity, child as Domain);
      continue;
    }
    assertReadableFields(ctx, entity, [key]);
    if (isExtPath(key)) {
      extFieldOf(entity, key); // AC-4: registered ext keys only (throws with the registered list)
      continue;
    }
    if (!(key in entity.config.fields) && !(key in entity.columns)) {
      throw new ValidationError(
        `unknown field "${key}" in where`,
        [{ path: `where.${key}`, message: 'unknown field' }],
        `Valid fields: ${entity.fieldNames.join(', ')}`,
      );
    }
  }
  return compileDomain(ctx, entity, where);
}

export function orderClauses(entity: EntityDef, orderBy: ListQuery['orderBy'], ctx?: Context): SQL[] {
  const requested = orderBy && orderBy.length > 0 ? orderBy : [{ field: 'createdAt', dir: 'desc' as const }];
  // LIMIT/OFFSET must use a total order: imports commonly share createdAt and business dates.
  // Keep an explicitly requested id direction; otherwise break ties with the unique primary key.
  const specs = requested.some((item) => item.field === 'id')
    ? requested
    : [...requested, { field: 'id', dir: 'asc' as const }];
  return specs.map((o) => {
    if (ctx) assertReadableFields(ctx, entity, [o.field]);
    if (!(o.field in entity.columns))
      throw new ValidationError(`cannot order by unknown field "${o.field}"`, [
        { path: 'orderBy', message: 'unknown field' },
      ]);
    const col = entity.col(o.field);
    return o.dir === 'desc' ? desc(col) : asc(col);
  });
}

export function combine(...conds: (SQL | undefined)[]): SQL | undefined {
  const present = conds.filter((c): c is SQL => c !== undefined);
  if (present.length === 0) return undefined;
  return present.length === 1 ? present[0] : and(...present);
}
