// Generic `<entity>.export_rows` (docs/specs/list-workbench.md AC-7..AC-9): the rows of the generic list as a
// TableResult for the browser's CSV. Rows are read page by page through the Repository with the caller's Context, so
// row rules, company/site scope, field masks and outputHidden apply exactly as in `<entity>.list`; the permission is the
// entity's `export` operation, and every export leaves one audit entry (entity, criteria summary, row count, actor).
// The values are the list as displayed: ref columns carry the referenced record's display value (read with the caller's
// own read permission on the target; the id when it cannot be read), enum and document state their label.
import { z } from 'zod';
import type { Context } from '../context.ts';
import { defineAction } from '../dsl/action.ts';
import type { EntityDef } from '../dsl/entity.ts';
import type { AnyField } from '../dsl/fields.ts';
import type { Domain } from '../dsl/types.ts';
import { PermissionDenied, ValidationError } from '../errors.ts';
import { label, type Label, type Locale } from '../i18n.ts';
import { newId } from '../ids.ts';
import { writeAudit } from '../audit.ts';
import { extFieldMetas, fieldMeta } from '../meta.ts';
import { assertReadableFields } from '../permissions.ts';
import { publicOutput } from '../public-output.ts';
import { registry } from '../registry.ts';
import { listQuerySchema, MAX_LIMIT, type ListQuery } from '../repository/query.ts';
import { repo } from '../repository/repository.ts';
import { snapshot } from '../repository/rows.ts';
import { tableResult, type ColumnKind, type TableColumn } from '../table-result.ts';

/** Rows one export returns at most; beyond it `meta.truncated` is true and `meta.total` tells how many matched. */
export const EXPORT_ROWS_LIMIT = 5000;
const MAX_COLUMNS = 100;

const DOCUMENT_COLUMNS: Record<'number' | 'docstatus', Label> = {
  number: label('番号', 'Number'),
  docstatus: label('状態', 'Status'),
};
const DOCSTATUS_LABELS: Record<number, Label> = {
  0: label('下書き', 'Draft'),
  1: label('確定', 'Submitted'),
  2: label('取消', 'Cancelled'),
};

export const exportRowsInput = z
  .object({
    where: listQuerySchema.shape.where,
    search: listQuerySchema.shape.search,
    orderBy: listQuerySchema.shape.orderBy,
    /** Columns in output order: entity fields, `ext.<key>`, and for documents `number` / `docstatus`. Default: the list view. */
    columns: z.array(z.string().min(1).max(120)).min(1).max(MAX_COLUMNS).optional(),
    /** Language of enum and document-state labels. Default: the request's locale. */
    locale: z.enum(['ja', 'en']).optional(),
  })
  .strict();

type Row = Record<string, unknown>;

interface ExportColumn {
  key: string;
  label: Label;
  kind: ColumnKind;
  /** Read the cell from a public row. */
  read: (row: Row) => unknown;
  field?: AnyField;
}

function extObject(row: Row): Row {
  const ext = row.ext;
  return typeof ext === 'object' && ext !== null && !Array.isArray(ext) ? (ext as Row) : {};
}

function columnKind(field: AnyField): ColumnKind {
  switch (field.kind) {
    case 'decimal':
      return 'decimal';
    case 'int':
      return 'int';
    case 'date':
      return 'date';
    case 'bool':
      return 'bool';
    default:
      // ref cells become display text; enum cells their label; timestamps/uuid/json stay JSON text.
      return 'text';
  }
}

/** The list view's columns as the caller's /meta shows them (documents lead with number and state). */
function defaultColumns(ctx: Context, entity: EntityDef): string[] {
  const visible = (name: string) => {
    try {
      assertReadableFields(ctx, entity, [name]);
      return name in entity.config.fields;
    } catch (error) {
      if (error instanceof PermissionDenied) return false;
      throw error;
    }
  };
  const nonHidden = entity.fieldNames.filter((f) => visible(f) && !entity.config.fields[f]?.opts.hidden);
  const list = [...(entity.config.views?.list ?? nonHidden.slice(0, 6))].filter(
    (f) => visible(f) && f !== 'number' && f !== 'docstatus',
  );
  return [...(entity.kind === 'document' ? ['number', 'docstatus'] : []), ...list];
}

function resolveColumn(ctx: Context, entity: EntityDef, name: string): ExportColumn {
  const appliedPacks = ctx.appliedPacks ?? [];
  if (entity.kind === 'document' && (name === 'number' || name === 'docstatus'))
    return { key: name, label: DOCUMENT_COLUMNS[name], kind: 'text', read: (row) => row[name] };
  if (name.startsWith('ext.')) {
    const key = name.slice(4);
    const meta = extFieldMetas(entity, { appliedPacks }).find((f) => f.name === name);
    const def = registry.extFields(entity.name).find((d) => d.key === key);
    if (!meta || !def) throw unknownColumn(entity, name);
    assertReadableFields(ctx, entity, [name]);
    return {
      key: name,
      label: meta.label,
      kind: columnKind(def.field),
      field: def.field,
      read: (r) => extObject(r)[key],
    };
  }
  const field = entity.config.fields[name];
  if (!field) throw unknownColumn(entity, name);
  // Masked (field group) and outputHidden fields are refused like a where/orderBy on them.
  assertReadableFields(ctx, entity, [name]);
  const meta = fieldMeta(entity, name, { appliedPacks });
  return { key: name, label: meta.label, kind: columnKind(field), field, read: (row) => row[name] };
}

function unknownColumn(entity: EntityDef, name: string): ValidationError {
  return new ValidationError(
    `unknown column "${name}" for ${entity.name}.export_rows`,
    [{ path: 'columns', message: `unknown column ${name}` }],
    `Use field names from GET /meta (entities[].fields / extFields)${entity.kind === 'document' ? ', number or docstatus' : ''}.`,
  );
}

function displayValue(row: Row, displayField: string | undefined): string | undefined {
  for (const key of [displayField, 'name', 'number', 'code']) {
    const value = key ? row[key] : undefined;
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

/**
 * id -> display value of the referenced records, read through the target's Repository with the caller's Context: a
 * target the caller cannot read (or a row it cannot see) keeps the id, so the export never shows more than /e/<target>.
 */
async function refLabels(ctx: Context, field: AnyField, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const target = field.ref && registry.hasEntity(field.ref) ? registry.entity(field.ref) : undefined;
  if (!target || ids.length === 0) return out;
  const displayField = (field.opts as { displayField?: string }).displayField ?? target.displayField;
  try {
    for (let i = 0; i < ids.length; i += MAX_LIMIT) {
      const chunk = ids.slice(i, i + MAX_LIMIT);
      const page = await repo(ctx, target).list({ where: { id: { $in: chunk } }, limit: MAX_LIMIT });
      for (const item of page.items) {
        const row = publicOutput(target, item as Row);
        const shown = displayValue(row, displayField);
        if (shown) out.set(String(row.id), shown);
      }
    }
  } catch (error) {
    if (error instanceof PermissionDenied) return new Map();
    throw error;
  }
  return out;
}

function enumLabel(field: AnyField, value: unknown, locale: Locale): unknown {
  const labels = (field.opts as { labels?: Record<string, Label> }).labels;
  const l = typeof value === 'string' ? labels?.[value] : undefined;
  return l ? l[locale] || l.en : value;
}

function cellText(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  return typeof value === 'object' ? JSON.stringify(value) : value;
}

/** Reads up to EXPORT_ROWS_LIMIT public rows in pages of the Repository's own maximum. */
async function readRows(
  ctx: Context,
  entity: EntityDef,
  query: Pick<ListQuery, 'where' | 'search' | 'orderBy'>,
): Promise<{ rows: Row[]; total: number }> {
  const r = repo(ctx, entity);
  const rows: Row[] = [];
  let total = 0;
  for (let offset = 0; offset < EXPORT_ROWS_LIMIT; offset += MAX_LIMIT) {
    const limit = Math.min(MAX_LIMIT, EXPORT_ROWS_LIMIT - offset);
    const page = await r.list({ ...query, limit, offset });
    if (offset === 0) total = page.total;
    for (const item of page.items) rows.push(snapshot(publicOutput(entity, item as Row)));
    if (page.items.length < limit || rows.length >= total) break;
  }
  return { rows, total };
}

export function registerExportRowsAction(entity: EntityDef): void {
  const name = `${entity.name}.export_rows`;
  if (registry.hasAction(name)) return;
  const { ja, en } = entity.config.label;
  defineAction(
    {
      name,
      description: label(
        `${ja}の一覧を CSV 用の表示値の表で返します（最大 ${EXPORT_ROWS_LIMIT} 行）。出力権限が必要で、監査に記録します。`,
        `Return ${en} list rows as display values for CSV (max ${EXPORT_ROWS_LIMIT} rows). Needs export permission; audited.`,
      ),
      input: exportRowsInput,
      output: tableResult,
      permission: { entity: entity.name, op: 'export' },
      mutates: false,
      handler: async (ctx, input) => {
        const locale: Locale = input.locale ?? ctx.locale ?? 'ja';
        const names = input.columns ?? defaultColumns(ctx, entity);
        if (new Set(names).size !== names.length)
          throw new ValidationError(`duplicate column in ${name}`, [{ path: 'columns', message: 'duplicate column' }]);
        const columns = names.map((column) => resolveColumn(ctx, entity, column));
        const query: Pick<ListQuery, 'where' | 'search' | 'orderBy'> = {
          ...(input.where ? { where: input.where as Domain } : {}),
          ...(input.search ? { search: input.search } : {}),
          ...(input.orderBy ? { orderBy: input.orderBy as NonNullable<ListQuery['orderBy']> } : {}),
        };
        const { rows, total } = await readRows(ctx, entity, query);
        const refs = new Map<string, Map<string, string>>();
        for (const column of columns) {
          if (column.field?.kind !== 'ref') continue;
          const ids = [...new Set(rows.map(column.read).filter((v): v is string => typeof v === 'string'))];
          refs.set(column.key, await refLabels(ctx, column.field, ids));
        }
        const out = rows.map((row) =>
          Object.fromEntries(
            columns.map((column) => {
              const value = column.read(row);
              if (column.key === 'docstatus' && !column.field)
                return [column.key, typeof value === 'number' ? (DOCSTATUS_LABELS[value]?.[locale] ?? value) : null];
              if (column.field?.kind === 'ref')
                return [column.key, typeof value === 'string' ? (refs.get(column.key)?.get(value) ?? value) : null];
              if (column.field?.kind === 'enum') return [column.key, cellText(enumLabel(column.field, value, locale))];
              return [column.key, cellText(value)];
            }),
          ),
        );
        const truncated = total > out.length;
        await writeAudit(
          ctx,
          entity.name,
          newId(),
          'export',
          null,
          {
            export: {
              ...query,
              columns: names,
              rows: out.length,
              total,
              truncated,
            },
          },
          name,
        );
        const tableColumns: TableColumn[] = columns.map((c) => ({
          key: c.key,
          label: c.label,
          kind: c.kind,
          align: c.kind === 'decimal' || c.kind === 'int' ? 'right' : 'left',
        }));
        return {
          title: registry.labelOverrides(entity.name, ctx.appliedPacks)?.entity ?? entity.config.label,
          columns: tableColumns,
          rows: out,
          meta: { entity: entity.name, total, rowCount: out.length, limit: EXPORT_ROWS_LIMIT, truncated },
        };
      },
    },
    { generic: true },
  );
}
