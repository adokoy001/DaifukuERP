// Equality indexes deliberately bound the indexed text, preserving legacy/free-form values of arbitrary length.
// Query candidates must still pass the original full-text equality/IN condition (ADR-0026).
import { createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

export const EXT_EQUALITY_PREFIX_LENGTH = 128;
export const EXT_KEY_PATTERN = /^[a-z][A-Za-z0-9]*$/;

/** Validated registry keys are literals, also in generated-column definitions. Field values stay bound. */
export function extTextExpression(column: AnyPgColumn | SQL, key: string): SQL {
  if (!EXT_KEY_PATTERN.test(key)) throw new Error('Invalid registered ext key');
  return sql`(${column} ->> '${sql.raw(key)}')`;
}

/** PostgreSQL left() counts characters; use it for both stored values and bound inputs, never JS slice(). */
export function extEqualityPrefix(value: SQL): SQL {
  return sql`left(${value}, ${sql.raw(String(EXT_EQUALITY_PREFIX_LENGTH))})`;
}

/** Stable across pack load order and owner changes, within PostgreSQL's 63-byte identifier limit. */
export function extEqualityIndexName(entity: string, key: string): string {
  const identity = `${entity}:ext:${key}:equality-prefix-${EXT_EQUALITY_PREFIX_LENGTH}`;
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 12);
  return `${`${entity}_ext_${key}_eq`.slice(0, 46)}_${hash}_idx`;
}

/** Internal generated columns are schema-only: never part of public entity fields or INSERT values. */
export function extEqualityColumnName(key: string): string {
  if (!EXT_KEY_PATTERN.test(key)) throw new Error('Invalid registered ext key');
  const hash = createHash('sha256')
    .update(`ext:${key}:prefix-${EXT_EQUALITY_PREFIX_LENGTH}`)
    .digest('hex')
    .slice(0, 12);
  return `_ext_eq_${key.slice(0, 40)}_${hash}`;
}

export function extEqualityColumn(table: PgTable, key: string): SQL {
  return sql`${table}.${sql.identifier(extEqualityColumnName(key))}`;
}
