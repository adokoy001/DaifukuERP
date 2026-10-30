// CSV import port (docs/specs/csv-import.md AC-2..AC-10, ADR-0028): rows of strings -> Repository.create / update, one
// savepoint per row. Dry-run runs the very same writes (permissions, row rules, validation, hooks, audit) inside an outer
// savepoint that is rolled back at the end; `atomic` rolls the outer savepoint back when any row failed.
import { z } from 'zod';
import type { Context } from './context.ts';
import { Decimal, isDecimal } from './decimal.ts';
import type { EntityDef } from './dsl/entity.ts';
import type { AnyField } from './dsl/fields.ts';
import { DaifukuError, PermissionDenied, safeErrorDiagnostics, StateError, ValidationError } from './errors.ts';
import type { Locale } from './i18n.ts';
import {
  coerceCell,
  defaultKeyField,
  importFields,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  isImportable,
  isUuid,
  resolveHeader,
  storedText,
  templateHeaders,
  type IgnoredReason,
} from './import-values.ts';
import { assertOp, assertWritableFields, can, maskedFields } from './permissions.ts';
import { registry } from './registry.ts';
import { repo } from './repository/repository.ts';
import { withSavepoint } from './transactions.ts';

export { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, isImportable } from './import-values.ts';

// ---- contract ---------------------------------------------------------------------------------------

/** AC-2: the request. Cells are strings (blank or null = not given); columns are field names or ja/en labels. */
export const importInputSchema = z
  .object({
    rows: z
      .array(z.record(z.string().min(1).max(200), z.string().max(10_000).nullable()))
      .min(1)
      .max(IMPORT_MAX_ROWS),
    mode: z.enum(['dry-run', 'execute']),
    onExisting: z.enum(['skip', 'update', 'error']),
    keyField: z.string().min(1).max(100).optional(),
    atomic: z.boolean().optional(),
  })
  .strict();
export type ImportInput = z.output<typeof importInputSchema>;

const messageSchema = z.object({
  /** Kernel error code (VALIDATION, CONFLICT, …) or an import code: invalid_value, ref_not_found, ref_ambiguous,
   * exists, immutable, unchanged, database. */
  code: z.string(),
  message: z.string(),
  field: z.string().optional(),
  /** The input column the field came from. */
  column: z.string().optional(),
  hint: z.string().optional(),
});
export type ImportMessage = z.output<typeof messageSchema>;

const rowResultSchema = z.object({
  /** 1-based data row number (the header is not counted). */
  line: z.number().int().min(1),
  status: z.enum(['created', 'updated', 'skipped', 'error']),
  id: z.uuid().optional(),
  messages: z.array(messageSchema).optional(),
});
export type ImportRowResult = z.output<typeof rowResultSchema>;

/** AC-8 (+ `committed`, `keyField`, `notices`; see the spec's open questions). */
export const importResultSchema = z.object({
  mode: z.enum(['dry-run', 'execute']),
  /** false when nothing is kept: every dry-run, and an atomic import with at least one failed row. */
  committed: z.boolean(),
  keyField: z.string().nullable(),
  summary: z.object({
    created: z.number().int(),
    updated: z.number().int(),
    skipped: z.number().int(),
    errors: z.number().int(),
  }),
  rows: z.array(rowResultSchema),
  /** AC-9: columns that were present but ignored (server-owned, system, ext, unsupported kind). */
  notices: z.array(
    z.object({
      column: z.string(),
      reason: z.enum(['server-owned', 'system', 'ext', 'unsupported']),
      message: z.string(),
    }),
  ),
});
export type ImportResult = z.output<typeof importResultSchema>;

// ---- planning (whole-request checks: AC-2, AC-5, AC-9) -------------------------------------------------

interface Plan {
  entity: EntityDef;
  /** input column -> field */
  columns: [string, string][];
  columnOf: Map<string, string>;
  keyField: string | undefined;
  notices: ImportResult['notices'];
}

const KEY_KINDS = new Set(['text', 'int', 'date', 'enum', 'uuid']);
const PREFETCH_CHUNK = 500;
const IGNORED_MESSAGE: Record<IgnoredReason, string> = {
  'server-owned': 'set by the system; the column is ignored',
  system: 'system column; the column is ignored',
  ext: 'ext fields are not imported in this version; the column is ignored',
  unsupported: 'this field type is not imported; the column is ignored',
};

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** AC-1: documents and line entities (and masters without importable fields) have no import. */
export function assertImportable(entity: EntityDef): void {
  if (!isImportable(entity))
    throw new StateError(
      `${entity.name} cannot be imported`,
      'Import covers master entities only; documents and their lines are entered through their own screens/actions.',
      { entity: entity.name },
    );
}

function plan(ctx: Context, entity: EntityDef, input: ImportInput): Plan {
  assertImportable(entity);
  assertOp(ctx, entity, 'create');
  if (input.onExisting === 'update') assertOp(ctx, entity, 'update');
  if (utf8Bytes(JSON.stringify(input)) > IMPORT_MAX_BYTES)
    throw new ValidationError(
      `import request exceeds ${IMPORT_MAX_BYTES} bytes`,
      [{ path: 'rows', message: `at most ${IMPORT_MAX_BYTES} bytes per request` }],
      'Split the file and import it in several requests.',
    );
  const headers = [...new Set(input.rows.flatMap((row) => Object.keys(row)))];
  const columns: [string, string][] = [];
  const notices: ImportResult['notices'] = [];
  const issues: { path: string; message: string }[] = [];
  for (const header of headers) {
    const r = resolveHeader(entity, header, ctx.appliedPacks);
    if (r.kind === 'field') columns.push([header, r.field]);
    else if (r.kind === 'ignored')
      notices.push({ column: header, reason: r.reason, message: IGNORED_MESSAGE[r.reason] });
    else if (r.kind === 'ambiguous')
      issues.push({ path: `rows.${header}`, message: `column matches several fields: ${r.fields.join(', ')}` });
    else issues.push({ path: `rows.${header}`, message: 'unknown column' });
  }
  const seen = new Map<string, string>();
  for (const [column, field] of columns) {
    const prior = seen.get(field);
    if (prior) issues.push({ path: `rows.${column}`, message: `column maps to ${field}, as does "${prior}"` });
    seen.set(field, column);
  }
  if (issues.length)
    throw new ValidationError(
      `${entity.name}: the import columns do not match the entity`,
      issues,
      `Use field names or their ja/en labels (GET /api/${entity.name}/import-template.csv): ${importFields(
        entity,
        ctx.appliedPacks,
      )
        .map((f) => f.name)
        .join(', ')}.`,
    );
  // AC-9: a column for a field the caller may not write rejects the whole import (not every row one by one).
  assertWritableFields(ctx, entity, [...seen.keys()]);
  for (const field of seen.keys()) {
    const target = entity.config.fields[field]?.ref;
    if (target && registry.hasEntity(target) && !can(ctx, registry.entity(target), 'read'))
      throw new PermissionDenied(target, 'read', ctx.roles);
  }
  const keyField = resolveKeyField(entity, input.keyField, seen);
  if (keyField) assertOp(ctx, entity, 'read');
  return { entity, columns, columnOf: seen, keyField, notices };
}

/** AC-5: explicit keyField must be a unique scalar field present in the file; the default applies only when present. */
function resolveKeyField(entity: EntityDef, requested: string | undefined, mapped: Map<string, string>) {
  if (requested === undefined) {
    const fallback = defaultKeyField(entity);
    return fallback && mapped.has(fallback) ? fallback : undefined;
  }
  const fd = entity.config.fields[requested];
  if (!fd || !fd.opts.unique || !KEY_KINDS.has(fd.kind) || !importFields(entity).some((f) => f.name === requested))
    throw new ValidationError(
      `${entity.name}.${requested} cannot be the import key`,
      [{ path: 'keyField', message: 'must be a unique text/int/date/enum/uuid field of the entity' }],
      'Omit keyField to use the first unique text field, or name a unique field.',
    );
  if (!mapped.has(requested))
    throw new ValidationError(
      `the import has no column for keyField ${requested}`,
      [{ path: 'keyField', message: 'column missing' }],
      'Add the key column to the file, or omit keyField.',
    );
  return requested;
}

// ---- rows ------------------------------------------------------------------------------------------

type Values = Record<string, unknown>;
type RefCache = Map<string, string>;

class RowFailure extends Error {
  constructor(readonly messages: ImportMessage[]) {
    super('import row failed');
  }
}

function fieldMessage(p: Plan, field: string, code: string, message: string, hint?: string): ImportMessage {
  const column = p.columnOf.get(field);
  return { code, message, field, ...(column ? { column } : {}), ...(hint ? { hint } : {}) };
}

/** AC-3/AC-4: `ref` cells by id, then the target's `code`, then its displayField; 0 or 2+ matches fail the row. */
async function resolveRef(ctx: Context, cache: RefCache, fd: AnyField, text: string): Promise<string | ImportMessage> {
  // A target outside the entity registry (e.g. `@company`) has no Repository: only its id can be given.
  if (!registry.hasEntity(fd.ref ?? ''))
    return isUuid(text)
      ? text.toLowerCase()
      : { code: 'ref_not_found', message: `"${text}" is not an id of ${fd.ref ?? 'the target'}` };
  const target = registry.entity(fd.ref ?? '');
  const key = `${target.name}\u0000${text}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const r = repo(ctx, target);
  if (isUuid(text)) {
    const row = await r.find(text.toLowerCase());
    if (row) {
      cache.set(key, row.id);
      return row.id;
    }
  }
  const masked = maskedFields(ctx, target);
  const display = (fd.opts as { displayField?: string }).displayField ?? target.displayField;
  const lookups = [...new Set(['code', ...(display ? [display] : [])])].filter((name) => {
    const tfd = target.config.fields[name];
    return tfd?.kind === 'text' && !tfd.opts.outputHidden && !masked.has(name);
  });
  for (const name of lookups) {
    const found = await r.list({ where: { [name]: storedText(target.config.fields[name], text) }, limit: 2 });
    if (found.items.length === 1 && found.items[0]) {
      cache.set(key, found.items[0].id);
      return found.items[0].id;
    }
    if (found.items.length > 1)
      return {
        code: 'ref_ambiguous',
        message: `"${text}" matches several ${target.name} records by ${name}`,
        hint: `Use the ${target.name} code (or id) instead.`,
      };
  }
  return {
    code: 'ref_not_found',
    message: `no ${target.name} matches "${text}" (${lookups.join(' / ') || 'id'})`,
    hint: `Register the ${target.name} first, or correct the value.`,
  };
}

async function rowValues(ctx: Context, p: Plan, cache: RefCache, row: Record<string, string | null>): Promise<Values> {
  const values: Values = {};
  const messages: ImportMessage[] = [];
  for (const [column, field] of p.columns) {
    const fd = p.entity.config.fields[field] as AnyField;
    const cell = coerceCell(fd, row[column]);
    if (cell.status === 'value') values[field] = cell.value;
    else if (cell.status === 'invalid') messages.push(fieldMessage(p, field, 'invalid_value', cell.message));
    else if (cell.status === 'lookup') {
      const ref = await resolveRef(ctx, cache, fd, cell.text);
      if (typeof ref === 'string') values[field] = ref;
      else messages.push({ ...fieldMessage(p, field, ref.code, ref.message, ref.hint) });
    }
  }
  if (messages.length) throw new RowFailure(messages);
  return values;
}

type Existing = Values & { id: string; version: number };

/** Rows' state shared across the request: resolved refs and the existing records by key (kept in step with writes). */
interface RowState {
  refs: RefCache;
  existing: Map<string, Existing>;
}

function keyOf(p: Plan, value: unknown): string | undefined {
  if (!p.keyField) return undefined;
  if (typeof value === 'string') return storedText(p.entity.config.fields[p.keyField], value);
  return typeof value === 'number' ? String(value) : undefined;
}

/** AC-5: one `$in` read per 500 keys instead of one read per row (the Repository's read visibility applies). */
async function prefetchExisting(ctx: Context, p: Plan, input: ImportInput): Promise<Map<string, Existing>> {
  const existing = new Map<string, Existing>();
  const keyField = p.keyField;
  const column = keyField ? p.columnOf.get(keyField) : undefined;
  if (!keyField || !column) return existing;
  const fd = p.entity.config.fields[keyField] as AnyField;
  // key -> the value as the column stores it (int keys stay numbers in the query)
  const keys = new Map<string, string | number>();
  for (const row of input.rows) {
    const cell = coerceCell(fd, row[column]);
    if (cell.status !== 'value') continue;
    const key = keyOf(p, cell.value);
    if (key !== undefined) keys.set(key, typeof cell.value === 'number' ? cell.value : key);
  }
  const all = [...keys.values()];
  const r = repo(ctx, p.entity);
  for (let i = 0; i < all.length; i += PREFETCH_CHUNK) {
    const chunk = all.slice(i, i + PREFETCH_CHUNK);
    const found = await r.list({ where: { [keyField]: { $in: chunk } }, limit: PREFETCH_CHUNK });
    for (const row of found.items as unknown as Existing[]) {
      const key = keyOf(p, row[keyField]);
      if (key !== undefined) existing.set(key, row);
    }
  }
  return existing;
}

function sameValue(fd: AnyField, current: unknown, next: unknown): boolean {
  if (current === null || current === undefined) return false;
  if (fd.kind === 'decimal') return isDecimal(current) && current.eq(Decimal.from(next as string));
  if (fd.kind === 'timestamp') return current instanceof Date && next instanceof Date && +current === +next;
  if (fd.kind === 'text') return current === storedText(fd, next as string);
  return current === next;
}

/** AC-5: the patch holds only changed fields; an immutable field may repeat its value but not change it. */
function updatePatch(p: Plan, existing: Values, values: Values): Values {
  const patch: Values = {};
  const messages: ImportMessage[] = [];
  for (const [field, next] of Object.entries(values)) {
    if (field === p.keyField) continue;
    const fd = p.entity.config.fields[field] as AnyField;
    if (sameValue(fd, existing[field], next)) continue;
    if (fd.opts.immutable && existing[field] !== null && existing[field] !== undefined)
      messages.push(
        fieldMessage(
          p,
          field,
          'immutable',
          `${field} cannot change after create`,
          'Leave the cell blank or unchanged.',
        ),
      );
    else patch[field] = next;
  }
  if (messages.length) throw new RowFailure(messages);
  return patch;
}

async function writeRow(
  ctx: Context,
  p: Plan,
  input: ImportInput,
  state: RowState,
  row: Record<string, string | null>,
  line: number,
): Promise<ImportRowResult> {
  const values = await rowValues(ctx, p, state.refs, row);
  const key = p.keyField ? keyOf(p, values[p.keyField]) : undefined;
  const r = repo(ctx, p.entity);
  const current = key === undefined ? undefined : state.existing.get(key);
  if (!current) {
    const created = (await r.create(values as never)) as unknown as Existing;
    // A later row with the same key sees this one, as a re-run of the file would.
    if (key !== undefined) state.existing.set(key, created);
    return { line, status: 'created', id: created.id };
  }
  if (input.onExisting === 'skip') return { line, status: 'skipped', id: current.id };
  if (input.onExisting === 'error')
    throw new RowFailure([
      fieldMessage(p, p.keyField as string, 'exists', `a record with ${p.keyField} "${key}" already exists`),
    ]);
  const patch = updatePatch(p, current, values);
  if (Object.keys(patch).length === 0)
    return { line, status: 'skipped', id: current.id, messages: [{ code: 'unchanged', message: 'no field changes' }] };
  const updated = await r.update(current.id, patch as never, { expectedVersion: current.version });
  if (key !== undefined) state.existing.set(key, updated as unknown as Existing);
  return { line, status: 'updated', id: current.id };
}

/** Kernel errors (and data/constraint SQL errors that escaped the Repository) fail the row; anything else the request. */
function failureMessages(p: Plan, err: unknown): ImportMessage[] | undefined {
  if (err instanceof RowFailure) return err.messages;
  if (err instanceof DaifukuError) {
    const issues = err instanceof ValidationError ? (err.details?.issues as { path: string; message: string }[]) : [];
    if (issues?.length)
      return issues.map((i) => {
        const field = i.path.split('.')[0];
        return field && field in p.entity.config.fields
          ? fieldMessage(p, field, err.code, i.message)
          : { code: err.code, message: i.path ? `${i.path}: ${i.message}` : i.message };
      });
    const field = typeof err.details?.field === 'string' ? err.details.field : undefined;
    return [
      field && field in p.entity.config.fields
        ? fieldMessage(p, field, err.code, err.message, err.hint)
        : { code: err.code, message: err.message, hint: err.hint },
    ];
  }
  const state = safeErrorDiagnostics(err).sqlState;
  if (state && (state.startsWith('22') || state.startsWith('23')))
    return [{ code: 'database', message: `the database rejected the row (SQLSTATE ${state})` }];
  return undefined;
}

const ROLLBACK = Symbol('import rollback');

/**
 * AC-6/AC-7: imports `input.rows` into `entity` through the Repository. Rows fail independently (per-row savepoints);
 * whole-request problems (permissions, columns, limits) throw before any row is written.
 */
export async function importRecords(ctx: Context, entity: EntityDef, raw: unknown): Promise<ImportResult> {
  const parsed = importInputSchema.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(
      `invalid input for ${entity.name}.import`,
      parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
      `Send { rows, mode, onExisting } with at most ${IMPORT_MAX_ROWS} rows of string cells.`,
    );
  const input = parsed.data;
  const p = plan(ctx, entity, input);
  const state: RowState = { refs: new Map(), existing: await prefetchExisting(ctx, p, input) };
  const rows: ImportRowResult[] = [];
  const runRows = async (scope: Context) => {
    for (const [index, row] of input.rows.entries()) {
      const line = index + 1;
      try {
        rows.push(await withSavepoint(scope, (sp) => writeRow(sp, p, input, state, row, line)));
      } catch (err) {
        const messages = failureMessages(p, err);
        if (!messages) throw err;
        rows.push({ line, status: 'error', messages });
      }
    }
  };
  let committed = true;
  if (input.mode === 'dry-run' || input.atomic) {
    try {
      await withSavepoint(ctx, async (sp) => {
        await runRows(sp);
        if (input.mode === 'dry-run' || rows.some((r) => r.status === 'error')) throw ROLLBACK;
      });
    } catch (err) {
      if (err !== ROLLBACK) throw err;
      committed = false;
    }
  } else await runRows(ctx);
  const count = (status: ImportRowResult['status']) => rows.filter((r) => r.status === status).length;
  return {
    mode: input.mode,
    committed,
    keyField: p.keyField ?? null,
    summary: {
      created: count('created'),
      updated: count('updated'),
      skipped: count('skipped'),
      errors: count('error'),
    },
    rows,
    notices: p.notices,
  };
}

// ---- template (AC-10) ----------------------------------------------------------------------------------

function csvCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** AC-10: a header-only CSV (UTF-8 with BOM, CRLF) of the fields the caller may import, labelled in `locale`. */
export function importTemplateCsv(ctx: Context, entity: EntityDef, locale: Locale): string {
  assertImportable(entity);
  assertOp(ctx, entity, 'create');
  const headers = templateHeaders(entity, locale, maskedFields(ctx, entity), ctx.appliedPacks);
  return `\uFEFF${headers.map(csvCell).join(',')}\r\n`;
}
