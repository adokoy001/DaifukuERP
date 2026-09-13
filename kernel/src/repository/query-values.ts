import type { PgColumn } from 'drizzle-orm/pg-core';
import type { DomainScalar } from '../dsl/types.ts';
import { ValidationError } from '../errors.ts';
import { isLocalDate } from '../ids.ts';

export type QueryScalar = DomainScalar | Date;
const zonedTimestamp =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
export const isTimestampColumn = (column: PgColumn): boolean =>
  column.columnType === 'PgTimestamp' && column.dataType === 'date';
/** JSON timestamps need Date operands for Drizzle's timestamp encoder; date/text columns keep their own meaning. */
export function queryScalar(column: PgColumn, value: DomainScalar, path: string): QueryScalar {
  if (!isTimestampColumn(column) || value === null) return value;
  if (typeof value === 'string' && zonedTimestamp.test(value) && isLocalDate(value.slice(0, 10))) {
    const instant = new Date(value);
    if (Number.isFinite(instant.getTime())) return instant;
  }
  throw new ValidationError('Invalid timestamp search value', [
    { path, message: 'Use YYYY-MM-DDTHH:mm:ss[.SSS] with Z or a ±HH:mm offset; maximum precision is milliseconds.' },
  ]);
}

const scalar = (value: unknown): value is DomainScalar =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));
/** Validate the whole operator object so an unsupported later condition can never be silently ignored. */
export function conditionEntries(field: string, condition: object): [string, unknown][] {
  const entries = Object.entries(condition);
  if (!entries.length)
    throw new ValidationError('Empty search condition', [
      { path: `where.${field}`, message: 'Provide a supported comparison operator.' },
    ]);
  for (const [op, value] of entries) {
    const path = `where.${field}.${op}`;
    if (op === '$in') {
      if (!Array.isArray(value))
        throw new ValidationError('Invalid search membership', [{ path, message: 'array required' }]);
      for (const [index, item] of value.entries())
        if (!scalar(item))
          throw new ValidationError('Invalid search operand', [
            { path: `${path}.${index}`, message: 'JSON scalar required' },
          ]);
    } else if (op === '$like') {
      if (typeof value !== 'string')
        throw new ValidationError('Invalid search pattern', [{ path, message: 'string required' }]);
    } else if (['$ne', '$gt', '$gte', '$lt', '$lte'].includes(op)) {
      if (!scalar(value))
        throw new ValidationError('Invalid search operand', [{ path, message: 'JSON scalar required' }]);
    } else
      throw new ValidationError('Unsupported search operator', [
        { path, message: 'Use $in, $ne, $gt, $gte, $lt, $lte or $like.' },
      ]);
  }
  return entries;
}
