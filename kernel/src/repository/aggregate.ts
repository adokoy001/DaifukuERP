// Aggregate queries (the `report` port, ADR-0013): grouped sums/counts/min/max over an entity, with the same
// visibility rules as list(). Enough for trial balances, tax summaries and aging; analytics proper is ADR-0012.
import { asc, count, desc, max, min, sql, sum, type SQL } from 'drizzle-orm';
import type { Context } from '../context.ts';
import { Decimal } from '../decimal.ts';
import type { EntityDef } from '../dsl/entity.ts';
import type { Domain } from '../dsl/types.ts';
import { ValidationError } from '../errors.ts';
import { assertOp, assertReadableFields, rowFilter } from '../permissions.ts';
import { combine, whereCondition } from './query.ts';
import { scopeCondition } from './scope.ts';

export type Metric = { sum: string } | { count: true } | { min: string } | { max: string };

export interface AggregateQuery {
  where?: Domain;
  /** Field names to group by (any column, including system columns such as companyId). */
  groupBy?: readonly string[];
  /** Output name -> metric. Sums over decimal fields return Decimal; counts return number. */
  metrics: Record<string, Metric>;
  orderBy?: readonly { field: string; dir?: 'asc' | 'desc' }[];
  limit?: number;
}

export type AggregateRow = Record<string, unknown>;

const MAX_ROWS = 10000;

function assertField(entity: EntityDef, name: string, where: string): void {
  if (!(name in entity.columns)) {
    throw new ValidationError(
      `unknown field "${name}" in ${where}`,
      [{ path: where, message: 'unknown field' }],
      `Valid fields: ${Object.keys(entity.columns).join(', ')}`,
    );
  }
}

export async function aggregate(ctx: Context, entity: EntityDef, q: AggregateQuery): Promise<AggregateRow[]> {
  assertOp(ctx, entity, 'read');
  const groupBy = q.groupBy ?? [];
  assertReadableFields(ctx, entity, groupBy);
  for (const g of groupBy) assertField(entity, g, 'groupBy');
  const selection: Record<string, SQL | ReturnType<typeof count>> = {};
  const groupCols = groupBy.map((g) => entity.col(g));
  for (const g of groupBy) selection[g] = sql`${entity.col(g)}`;
  const decimalMetrics = new Set<string>();
  for (const [name, m] of Object.entries(q.metrics)) {
    if (name in selection)
      throw new ValidationError(`metric "${name}" collides with a group field`, [
        { path: `metrics.${name}`, message: 'name collision' },
      ]);
    if ('count' in m) selection[name] = count();
    else {
      const field = 'sum' in m ? m.sum : 'min' in m ? m.min : m.max;
      assertReadableFields(ctx, entity, [field]);
      assertField(entity, field, `metrics.${name}`);
      const col = entity.col(field);
      selection[name] = 'sum' in m ? sum(col) : 'min' in m ? min(col) : max(col);
      if (entity.config.fields[field]?.kind === 'decimal') decimalMetrics.add(name);
    }
  }
  const cond = combine(
    scopeCondition(ctx, entity),
    rowFilter(ctx, entity, 'read'),
    whereCondition(ctx, entity, q.where),
  );
  const order = (q.orderBy ?? []).map((o) => {
    const target = groupBy.includes(o.field) ? sql`${entity.col(o.field)}` : selection[o.field];
    if (!target)
      throw new ValidationError(`cannot order by "${o.field}"`, [
        { path: 'orderBy', message: 'must be a group field or a metric' },
      ]);
    return o.dir === 'desc' ? desc(target as SQL) : asc(target as SQL);
  });
  const base = ctx.db
    .select(selection as Record<string, SQL>)
    .from(entity.table)
    .where(cond);
  const grouped = groupCols.length > 0 ? base.groupBy(...groupCols) : base;
  const rows = await grouped.orderBy(...order).limit(Math.min(q.limit ?? MAX_ROWS, MAX_ROWS));
  return (rows as AggregateRow[]).map((r) => {
    const out: AggregateRow = {};
    for (const [k, v] of Object.entries(r)) {
      if (decimalMetrics.has(k)) out[k] = v === null || v === undefined ? Decimal.zero() : Decimal.from(String(v));
      else if (k in q.metrics && 'count' in (q.metrics[k] as Metric)) out[k] = Number(v);
      else out[k] = v;
    }
    return out;
  });
}
