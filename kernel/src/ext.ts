// Runtime side of ext fields (ADR-0014). `buildSchemas` runs at definition time, before packs register ext keys, so the
// ext zod is built lazily here from the registry (cached per entity, rebuilt when registerExt bumps its extVersion):
// the Repository validates `ext` with it on insert/update, and the generic create/update actions document it.
import { z } from 'zod';
import { Decimal } from './decimal.ts';
import { fieldInputSchema } from './db/zod.ts';
import type { EntityDef } from './dsl/defs.ts';
import { ValidationError, type ValidationIssue } from './errors.ts';
import { registry } from './registry.ts';

type Raw = Record<string, unknown>;

interface CompiledExt {
  version: number;
  /** Registered keys validated; unknown keys passed through (ADR-0003 free-form one-off data stays possible). */
  object: z.ZodType;
  required: readonly string[];
  keys: readonly string[];
}

const cache = new Map<string, CompiledExt>();

function compiled(entity: EntityDef, appliedPacks?: readonly string[]): CompiledExt | undefined {
  if (!entity.hasExt) return undefined;
  const version = registry.extVersion(entity.name);
  if (version === 0) return undefined;
  const cacheKey = `${entity.name}:${appliedPacks ? [...appliedPacks].sort().join(',') : '*'}`;
  const hit = cache.get(cacheKey);
  if (hit?.version === version) return hit;
  const shape: Record<string, z.ZodType> = {};
  const required: string[] = [];
  for (const { key, field, source } of registry.extFields(entity.name)) {
    if (appliedPacks && source.startsWith('pack:') && !appliedPacks.includes(source.slice(5))) continue;
    const base = fieldInputSchema(field);
    shape[key] = field.required ? base : base.nullable().optional();
    if (field.required) required.push(key);
  }
  const next: CompiledExt = { version, object: z.looseObject(shape), required, keys: Object.keys(shape) };
  cache.set(cacheKey, next);
  return next;
}

/** JSON-safe canonical values for registered keys: Decimal -> decimal string (ADR-0010), Date -> ISO string. */
function canonical(values: Raw, keys: readonly string[]): Raw {
  const out: Raw = { ...values };
  for (const k of keys) {
    const v = out[k];
    if (v instanceof Decimal) out[k] = v.toString();
    else if (v instanceof Date) out[k] = v.toISOString();
  }
  return out;
}

function extError(entity: EntityDef, issues: ValidationIssue[]): ValidationError {
  return new ValidationError(
    `${entity.name}: invalid ext values`,
    issues,
    `Fix the listed ext fields. Their definitions are extFields in GET /meta/entities/${entity.name} (registered with registry.registerExt); unregistered keys are stored as given.`,
  );
}

/**
 * Validates `ext` for Repository.create/update (AC-2). Registered keys are checked with the field's zod, unknown keys are
 * kept. `insert`: required ext fields must be present even when `ext` is omitted. `update`: `ext` replaces the stored
 * object as a whole, so it is checked only when the patch carries it. Returns the value to store (undefined = leave out).
 */
export function validateExt(entity: EntityDef, ext: unknown, mode: 'insert' | 'update', appliedPacks?: readonly string[]): Raw | undefined {
  const c = compiled(entity, appliedPacks);
  if (!c) return ext as Raw | undefined;
  if (ext === undefined) {
    if (mode === 'update' || c.required.length === 0) return undefined;
    throw extError(entity, c.required.map((k) => ({ path: `ext.${k}`, message: 'required' })));
  }
  const parsed = c.object.safeParse(ext);
  if (!parsed.success) {
    throw extError(entity, parsed.error.issues.map((i) => ({ path: ['ext', ...i.path.map(String)].join('.'), message: i.message })));
  }
  return canonical(parsed.data as Raw, c.keys);
}

/**
 * Documented shape of `ext` in generic create/update inputs (OpenAPI, MCP tool schemas; AC-3), or undefined when the entity
 * has no registered ext fields. Documentation only: those actions are lenient and the Repository validates.
 */
export function extInputSchema(entity: EntityDef, mode: 'insert' | 'update'): z.ZodType | undefined {
  const c = compiled(entity);
  if (!c) return undefined;
  return mode === 'insert' && c.required.length > 0 ? c.object : c.object.optional();
}
