// Ext field definitions (ADR-0003, ADR-0014): typed keys inside an entity's JSONB `ext`, declared by packs / l10n /
// modules with `registry.registerExt(entity, fields, { source })`. This file holds the definition-time checks only;
// Repository validation lives in ../ext.ts and the JSONB where/search compilation in ../repository/ext-query.ts.
import { Conflict, ValidationError, type ValidationIssue } from '../errors.ts';
import type { EntityDef } from './defs.ts';
import type { AnyField, FieldKind, FieldMap } from './fields.ts';
import { DOCUMENT_FIELDS, SYSTEM_FIELDS } from './types.ts';

/** Path prefix used in where/meta: `ext.<key>`. */
export const EXT_PREFIX = 'ext.';
export const DEFAULT_EXT_SOURCE = 'unnamed';

export interface ExtFieldDef {
  readonly key: string;
  readonly field: AnyField;
  /** Owner named at registration (pack/module); shown in conflict hints and meta. */
  readonly source: string;
}

export interface RegisterExtOptions {
  /** Owning pack or module, e.g. `pack_retail`. */
  source?: string;
}

/** Kinds a JSONB value can hold. `ref` is stored as a uuid string (no FK inside JSONB). */
const EXT_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>([
  'text',
  'int',
  'decimal',
  'bool',
  'date',
  'timestamp',
  'enum',
  'ref',
  'json',
  'uuid',
]);
/** Options that only make sense for real columns (or would silently do nothing inside JSONB). */
const COLUMN_ONLY_OPTS = ['unique', 'index', 'immutable'] as const;
const KEY_RE = /^[a-z][A-Za-z0-9]*$/;

function keyIssues(entity: EntityDef, key: string, fd: AnyField): string[] {
  const out: string[] = [];
  const reserved = new Set<string>([...SYSTEM_FIELDS, ...DOCUMENT_FIELDS]);
  if (!KEY_RE.test(key)) out.push('ext keys must be camelCase (letters and digits, starting lowercase)');
  if (reserved.has(key)) out.push(`"${key}" is a system field name`);
  if (key in entity.config.fields) out.push(`"${key}" is already a field of ${entity.name}`);
  if (!EXT_KINDS.has(fd.kind)) out.push(`kind "${String(fd.kind)}" cannot live in JSONB ext`);
  const opts = fd.opts as Record<string, unknown>;
  for (const o of COLUMN_ONLY_OPTS)
    if (opts[o] === true) out.push(`option "${o}" is not supported for ext fields (no column)`);
  if (fd.hasDefault)
    out.push('option "default" is not supported for ext fields; set the value in a before_validate hook');
  return out;
}

/**
 * Checks a registration against the entity and the keys already registered for it, returning the definitions to add.
 * All-or-nothing: throws ValidationError (bad names/kinds/options, AC-12) or Conflict (key taken, AC-1) before any change.
 */
export function checkExtFields(
  entity: EntityDef,
  fields: FieldMap,
  existing: ReadonlyMap<string, ExtFieldDef>,
  source: string,
): ExtFieldDef[] {
  if (!entity.hasExt) {
    throw new ValidationError(
      `${entity.name} has no ext column`,
      [{ path: 'entity', message: 'declared with ext: false' }],
      `Enable ext on ${entity.name} (EntityConfig.ext) or add a real field in its module.`,
    );
  }
  const issues: ValidationIssue[] = [];
  for (const [key, fd] of Object.entries(fields)) {
    for (const message of keyIssues(entity, key, fd)) issues.push({ path: `ext.${key}`, message });
  }
  if (issues.length > 0) {
    throw new ValidationError(
      `registerExt(${entity.name}) from "${source}": invalid ext field definition`,
      issues,
      'Rename the ext keys so they do not collide with system or entity fields, and use a JSONB-compatible kind without column-only options.',
    );
  }
  const taken = Object.keys(fields).flatMap((key) => {
    const prev = existing.get(key);
    return prev ? [{ key, source: prev.source }] : [];
  });
  if (taken.length > 0) {
    const list = taken.map((t) => `"${t.key}" (registered by "${t.source}")`).join(', ');
    throw new Conflict(
      `registerExt(${entity.name}): ext key(s) ${list} already registered`,
      `"${source}" and ${[...new Set(taken.map((t) => `"${t.source}"`))].join(', ')} both define ${taken.map((t) => `ext.${t.key}`).join(', ')} on ${entity.name}. Rename the key in one of them, or register it only once.`,
      { entity: entity.name, source, conflicts: taken },
    );
  }
  return Object.entries(fields).map(([key, field]) => ({ key, field, source }));
}
