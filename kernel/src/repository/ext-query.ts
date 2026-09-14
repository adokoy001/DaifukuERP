// JSONB `ext.<key>` filters and search terms (ADR-0014 AC-4/AC-5). Only registered keys are accepted (a typo fails with
// the list of registered keys). Registered keys match a strict pattern, so they are inlined as SQL literals: the
// generated equality candidates and full comparison keep the same extraction. Values compare as text (`->>`), decimal values
// in canonical form; `$like` only on text kinds; range operators are refused (text order is not numeric order).
import { and, eq, ilike, inArray, isNotNull, isNull, like, ne, or, sql, type SQL } from 'drizzle-orm';
import { EXT_KEY_PATTERN, extEqualityColumn, extEqualityPrefix, extTextExpression } from '../db/ext-index.ts';
import { Decimal } from '../decimal.ts';
import type { EntityDef } from '../dsl/defs.ts';
import { EXT_PREFIX, type ExtFieldDef } from '../dsl/ext.ts';
import type { TextOpts } from '../dsl/fields.ts';
import type { DomainCondition, DomainScalar } from '../dsl/types.ts';
import { ValidationError } from '../errors.ts';
import { normalizeText } from '../normalize.ts';
import { registry } from '../registry.ts';

const SAFE_KEY = EXT_KEY_PATTERN;

export function isExtPath(field: string): boolean {
  return field.startsWith(EXT_PREFIX);
}

/** The registered ext field behind `ext.<key>`; ValidationError naming the registered keys otherwise. */
export function extFieldOf(entity: EntityDef, path: string): ExtFieldDef {
  const key = path.slice(EXT_PREFIX.length);
  const registered = entity.hasExt ? registry.extFields(entity.name) : [];
  const def = registered.find((d) => d.key === key);
  if (def && SAFE_KEY.test(def.key)) return def;
  const known = registered.map((d) => `${EXT_PREFIX}${d.key}`);
  throw new ValidationError(
    `unknown ext field "${path}" on ${entity.name}`,
    [{ path: `where.${path}`, message: 'ext key is not registered' }],
    known.length > 0
      ? `Registered ext fields: ${known.join(', ')}`
      : `${entity.name} has no registered ext fields; register them with registry.registerExt to filter on them.`,
  );
}

/** `(ext ->> '<key>')`. Inlining is safe: the key matched SAFE_KEY, so it cannot contain quotes. */
function extText(entity: EntityDef, key: string): SQL {
  return extTextExpression(entity.col('ext'), key);
}

function asText(def: ExtFieldDef, v: DomainScalar): string | null {
  if (v === null) return null;
  const s = String(v);
  return def.field.kind === 'decimal' && Decimal.isDecimalString(s) ? Decimal.from(s).toString() : s;
}

/** Compiles one domain condition on `ext.<key>`. `resolve` substitutes `$ctx.*` tokens like entity conditions do. */
export function compileExtCondition(
  entity: EntityDef,
  path: string,
  cond: DomainCondition,
  resolve: (v: DomainScalar) => DomainScalar,
): SQL {
  const def = extFieldOf(entity, path);
  const expr = extText(entity, def.key);
  const indexed = def.field.kind === 'text' && (def.field.opts as TextOpts).equalityIndex === true;
  const candidate = extEqualityColumn(entity.table, def.key);
  const nullMatch = indexed ? isNull(candidate) : isNull(expr);
  const text = (v: DomainScalar) => asText(def, resolve(v));
  if (cond === null || typeof cond !== 'object') {
    const v = cond === null ? null : text(cond);
    if (v === null) return nullMatch;
    const full = eq(expr, v);
    return indexed ? (and(eq(candidate, extEqualityPrefix(sql`${v}`)), full) ?? full) : full;
  }
  if ('$in' in cond) {
    const resolved = cond.$in.map(text);
    const values = resolved.filter((v): v is string => v !== null);
    const full = values.length === 0 ? sql`false` : inArray(expr, values);
    const matched =
      indexed && values.length > 0
        ? (and(
            inArray(
              candidate,
              values.map((v) => extEqualityPrefix(sql`${v}`)),
            ),
            full,
          ) ?? full)
        : full;
    return resolved.includes(null) ? (or(matched, nullMatch) ?? matched) : matched;
  }
  if ('$ne' in cond) {
    const v = text(cond.$ne);
    return v === null ? isNotNull(expr) : ne(expr, v);
  }
  if ('$like' in cond && def.field.kind === 'text') return like(expr, cond.$like);
  throw new ValidationError(
    `unsupported condition on ${path}`,
    [{ path: `where.${path}`, message: 'ext fields support equality, null, $in, $ne, and $like on text kinds' }],
    'Range operators on JSONB ext values are not supported (values compare as text). Filter on a real field, or use equality/$in.',
  );
}

function escapeLike(s: string): string {
  return s.replace(/[%_]/g, (m) => `\\${m}`);
}

/** ILIKE terms for registered text ext fields declared `searchable: true` (joined with the entity's search fields). */
export function extSearchConditions(entity: EntityDef, search: string): SQL[] {
  if (!entity.hasExt) return [];
  return registry
    .extFields(entity.name)
    .filter(
      (d) =>
        d.field.kind === 'text' &&
        !d.field.opts.outputHidden &&
        (d.field.opts as TextOpts).searchable === true &&
        SAFE_KEY.test(d.key),
    )
    .map((d) => {
      const mode = (d.field.opts as TextOpts).normalize;
      return ilike(extText(entity, d.key), `%${escapeLike(mode ? normalizeText(mode, search) : search)}%`);
    });
}
