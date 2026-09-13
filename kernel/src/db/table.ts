// Derives a Drizzle table (with tenant RLS policy) from an entity definition (ADR-0002, ADR-0004).
import { getTableColumns, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgColumn,
  type PgColumnBuilderBase,
  type PgTable,
} from 'drizzle-orm/pg-core';
import type { AnyField } from '../dsl/fields.ts';
import type { EntityConfig, DocumentConfig } from '../dsl/types.ts';

export type RefResolver = (entityName: string, column?: string) => AnyPgColumn | undefined;

export interface BuiltTable {
  table: PgTable;
  columns: Record<string, PgColumn>;
  /** TS field name -> DB column name */
  columnNames: Record<string, string>;
}

export const APP_ROLE = 'daifuku_app';
export const TENANT_SETTING = 'app.tenant_id';
export const TENANT_POLICY_SQL = sql.raw(`tenant_id = NULLIF(current_setting('${TENANT_SETTING}', true), '')::uuid`);

export function toSnake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

function columnFor(name: string, col: string, fd: AnyField, resolveRef: RefResolver): PgColumnBuilderBase {
  const o = fd.opts as Record<string, unknown>;
  let b: PgColumnBuilderBase;
  switch (fd.kind) {
    case 'text':
      b = text(col);
      break;
    case 'int':
      b = integer(col);
      break;
    case 'decimal':
      b = numeric(col, { precision: 20, scale: 6 });
      break;
    case 'bool':
      b = boolean(col);
      break;
    case 'date':
      b = date(col, { mode: 'string' });
      break;
    case 'timestamp':
      b = timestamp(col, { withTimezone: true, mode: 'date' });
      break;
    case 'enum':
      b = text(col);
      break;
    case 'json':
      b = jsonb(col);
      break;
    case 'uuid':
      b = uuid(col);
      break;
    case 'ref': {
      const target = fd.ref;
      if (!target) throw new Error(`field ${name}: ref target missing`);
      const onDelete = (o.onDelete as 'restrict' | 'cascade' | 'set null' | undefined) ?? 'restrict';
      b = uuid(col).references(() => resolveRef(target) as AnyPgColumn, { onDelete });
      break;
    }
  }
  // Builders share a common shape; the chained calls below exist on every concrete builder.
  const builder = b as unknown as {
    notNull(): PgColumnBuilderBase;
    default(v: unknown): PgColumnBuilderBase;
    defaultNow?(): PgColumnBuilderBase;
  };
  if (fd.required) b = builder.notNull();
  if (fd.hasDefault) b = applyDefault(b, fd);
  return b;
}

function applyDefault(b: PgColumnBuilderBase, fd: AnyField): PgColumnBuilderBase {
  const d = (fd.opts as { default?: unknown }).default;
  const builder = b as unknown as {
    default(v: unknown): PgColumnBuilderBase;
    defaultNow(): PgColumnBuilderBase;
    defaultRandom(): PgColumnBuilderBase;
  };
  if (fd.kind === 'timestamp' && d === 'now') return builder.defaultNow();
  if (fd.kind === 'date' && d === 'today') return builder.default(sql`CURRENT_DATE`);
  if (fd.kind === 'uuid' && d === 'new') return builder.defaultRandom();
  if (fd.kind === 'json') return builder.default(sql.raw(`'${JSON.stringify(d).replace(/'/g, "''")}'::jsonb`));
  return builder.default(d);
}

/** Builds the Drizzle table for an entity or document definition. */
export function buildTable(
  cfg: EntityConfig | DocumentConfig,
  kind: 'entity' | 'document',
  resolveRef: RefResolver,
): BuiltTable {
  const scope = cfg.scope ?? 'company';
  const columnNames: Record<string, string> = {};
  const cols: Record<string, PgColumnBuilderBase> = {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    version: integer('version').notNull().default(1),
  };
  if (scope === 'company') cols.companyId = uuid('company_id').notNull();
  if (cfg.ext !== false) cols.ext = jsonb('ext');
  if (kind === 'document') {
    cols.docstatus = smallint('docstatus').notNull().default(0);
    cols.number = text('number');
    cols.amendedFrom = uuid('amended_from');
  }
  for (const key of Object.keys(cols)) columnNames[key] = toSnake(key);

  for (const [name, fd] of Object.entries(cfg.fields)) {
    if (name in cols) throw new Error(`entity ${cfg.name}: field "${name}" collides with a system field`);
    const col = toSnake(name);
    columnNames[name] = col;
    cols[name] = columnFor(name, col, fd, resolveRef);
  }

  const table = pgTable(cfg.name, cols, (t) => {
    const tt = t as Record<string, AnyPgColumn>;
    const scopeCols = scope === 'company' ? [tt.tenantId, tt.companyId] : [tt.tenantId];
    const defs: unknown[] = [
      index(`${cfg.name}_tenant_idx`).on(...(scopeCols as [AnyPgColumn, ...AnyPgColumn[]])),
      unique(`${cfg.name}_scope_id_uq`).on(...(scopeCols as [AnyPgColumn, ...AnyPgColumn[]]), tt.id as AnyPgColumn),
      ...(scope === 'company'
        ? [unique(`${cfg.name}_tenant_id_uq`).on(tt.tenantId as AnyPgColumn, tt.id as AnyPgColumn)]
        : []),
      pgPolicy(`${cfg.name}_tenant_isolation`, {
        as: 'permissive',
        for: 'all',
        to: 'public',
        using: TENANT_POLICY_SQL,
        withCheck: TENANT_POLICY_SQL,
      }),
    ];
    if (scope === 'company')
      defs.push(
        foreignKey({
          name: `${cfg.name}_company_scope_fk`,
          columns: [tt.tenantId as AnyPgColumn, tt.companyId as AnyPgColumn],
          foreignColumns: [resolveRef('@company', 'tenantId') as AnyPgColumn, resolveRef('@company') as AnyPgColumn],
        }),
      );
    for (const [name, fd] of Object.entries(cfg.fields)) {
      const c = tt[name];
      if (!c) continue;
      if (fd.kind === 'ref' && fd.ref) {
        const targetTenant = resolveRef(fd.ref, 'tenantId') as AnyPgColumn;
        const targetCompany = resolveRef(fd.ref, 'companyId');
        const targetId = resolveRef(fd.ref) as AnyPgColumn;
        const local =
          scope === 'company' && targetCompany
            ? [tt.tenantId as AnyPgColumn, tt.companyId as AnyPgColumn, c]
            : [tt.tenantId as AnyPgColumn, c];
        const foreign =
          scope === 'company' && targetCompany ? [targetTenant, targetCompany, targetId] : [targetTenant, targetId];
        defs.push(
          foreignKey({
            name: `${cfg.name}_${toSnake(name)}_scope_fk`,
            columns: local as [AnyPgColumn, ...AnyPgColumn[]],
            foreignColumns: foreign as [AnyPgColumn, ...AnyPgColumn[]],
          }),
        );
      }
      if (fd.opts.unique)
        defs.push(
          uniqueIndex(`${cfg.name}_${toSnake(name)}_uq`).on(...(scopeCols as [AnyPgColumn, ...AnyPgColumn[]]), c),
        );
      else if (fd.opts.index || fd.kind === 'ref')
        defs.push(index(`${cfg.name}_${toSnake(name)}_idx`).on(...(scopeCols as [AnyPgColumn, ...AnyPgColumn[]]), c));
      if (fd.kind === 'enum' && fd.values) {
        const list = fd.values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
        defs.push(check(`${cfg.name}_${toSnake(name)}_chk`, sql.raw(`${toSnake(name)} IN (${list})`)));
      }
    }
    for (const u of cfg.unique ?? []) {
      defs.push(
        uniqueIndex(`${cfg.name}_${u.map(toSnake).join('_')}_uq`).on(
          ...(scopeCols as [AnyPgColumn, ...AnyPgColumn[]]),
          ...u.map((n) => tt[n] as AnyPgColumn),
        ),
      );
    }
    for (const ix of cfg.indexes ?? []) {
      defs.push(
        index(`${cfg.name}_${ix.map(toSnake).join('_')}_idx`).on(
          ...(scopeCols as [AnyPgColumn, ...AnyPgColumn[]]),
          ...ix.map((n) => tt[n] as AnyPgColumn),
        ),
      );
    }
    if (kind === 'document') {
      defs.push(
        uniqueIndex(`${cfg.name}_number_uq`).on(
          ...(scopeCols as [AnyPgColumn, ...AnyPgColumn[]]),
          tt.number as AnyPgColumn,
        ),
      );
      defs.push(check(`${cfg.name}_docstatus_chk`, sql.raw('docstatus IN (0, 1, 2)')));
    }
    return defs as never;
  }).enableRLS();

  return {
    table: table as unknown as PgTable,
    columns: getTableColumns(table as unknown as PgTable) as Record<string, PgColumn>,
    columnNames,
  };
}
