// defineEntity / defineDocument (ADR-0002, ADR-0006).
import type { AnyPgColumn, PgColumn } from 'drizzle-orm/pg-core';
import { buildTable } from '../db/table.ts';
import { buildSchemas } from '../db/zod.ts';
import { companies } from '../db/system-tables.ts';
import { registry } from '../registry.ts';
import type { FieldMap } from './fields.ts';
import type { EntityDef } from './defs.ts';
export type { EntityDef, Infer, InsertInput, UpdateInput } from './defs.ts';
import { DOCUMENT_FIELDS, SYSTEM_FIELDS, type DocumentConfig, type EntityConfig } from './types.ts';

const NAME_RE = /^[a-z][a-z0-9_]*$/;

function resolveRef(entityName: string, column = 'id'): AnyPgColumn | undefined {
  if (entityName === '@company') return column === 'tenantId' ? companies.tenantId : companies.id;
  const target = registry.entity(entityName);
  const id = target.columns[column];
  if (!id && column !== 'companyId') throw new Error(`entity ${entityName} has no ${column} column`);
  if (!id) return undefined;
  return id as AnyPgColumn;
}

function validateConfig(cfg: EntityConfig): void {
  if (!NAME_RE.test(cfg.name)) throw new Error(`entity name "${cfg.name}" must be snake_case (${NAME_RE})`);
  const known = (name: string, where: string) => {
    if (!(name in cfg.fields)) throw new Error(`entity ${cfg.name}: ${where} references unknown field "${name}"`);
  };
  if (cfg.displayField) known(cfg.displayField, 'displayField');
  for (const u of cfg.unique ?? []) for (const n of u) known(n, 'unique');
  for (const ix of cfg.indexes ?? []) for (const n of ix) known(n, 'indexes');
  for (const n of (cfg as DocumentConfig).allowOnSubmit ?? []) if (!n.startsWith('ext.')) known(n, 'allowOnSubmit');
  for (const v of [...(cfg.views?.list ?? []), ...(cfg.views?.search ?? [])]) known(v, 'views');
  const reserved = new Set<string>([...SYSTEM_FIELDS, ...DOCUMENT_FIELDS]);
  for (const [key, fd] of Object.entries(cfg.fields)) {
    if (reserved.has(key)) throw new Error(`entity ${cfg.name}: "${key}" is a reserved system field name`);
    if (!/^[a-z][A-Za-z0-9]*$/.test(key)) throw new Error(`entity ${cfg.name}: field "${key}" must be camelCase`);
    if ((fd.opts as { searchable?: boolean }).searchable)
      throw new Error(
        `entity ${cfg.name}: field "${key}" uses searchable, which is for ext fields only; list entity fields in views.search`,
      );
  }
  for (const [role, ops] of Object.entries(cfg.permissions.roles)) {
    if (!/^[a-z][a-z0-9_]*$/.test(role)) throw new Error(`entity ${cfg.name}: role "${role}" must be snake_case`);
    if (ops.length === 0) throw new Error(`entity ${cfg.name}: role "${role}" grants no operations; remove it`);
  }
  for (const g of Object.values(cfg.permissions.fieldGroups ?? {})) {
    for (const fname of g.fields)
      if (!(fname in cfg.fields)) throw new Error(`entity ${cfg.name}: fieldGroup references unknown field "${fname}"`);
  }
  for (const access of [cfg.storeAccess, cfg.siteAccess])
    if (access && access.kind !== 'sharedRead') {
      if (cfg.scope === 'tenant') throw new Error(`entity ${cfg.name}: store scope requires a company entity`);
      if (access.kind === 'store' && access.field === 'id') continue;
      const field = cfg.fields[access.field];
      if (field?.kind !== 'ref' || !field.required)
        throw new Error(`entity ${cfg.name}: store scope requires a required reference field`);
      if (access.kind === 'parent' && field.ref !== access.entity)
        throw new Error(`entity ${cfg.name}: store parent must match the reference target`);
    }
}

function build<F extends FieldMap, K extends 'entity' | 'document'>(
  kind: K,
  cfg: EntityConfig<F>,
  doc: DocumentConfig<F> | undefined,
): EntityDef<F, K> {
  validateConfig(cfg as EntityConfig);
  const hasExt = cfg.ext !== false;
  const built = buildTable(cfg as EntityConfig, kind, resolveRef);
  const maskable = new Set(Object.values(cfg.permissions.fieldGroups ?? {}).flatMap((g) => [...g.fields]));
  const schemas = buildSchemas(cfg.fields, { ext: hasExt, document: kind === 'document', maskable });
  const fieldNames = Object.keys(cfg.fields);
  const displayField =
    cfg.displayField ?? (fieldNames.includes('name') ? 'name' : fieldNames.includes('code') ? 'code' : undefined);
  const def: EntityDef<F, K> = {
    kind,
    name: cfg.name,
    config: cfg,
    doc,
    table: built.table,
    columns: built.columns,
    columnNames: built.columnNames,
    schemas,
    fieldNames,
    displayField,
    scope: cfg.scope ?? 'company',
    hasExt,
    audit: cfg.audit ?? 'full',
    module: undefined,
    col(name: string): PgColumn {
      const c = built.columns[name];
      if (!c) throw new Error(`entity ${cfg.name}: no column "${name}"`);
      return c;
    },
  };
  registry.registerEntity(def as unknown as EntityDef);
  return def;
}

/** Declares a master-data entity. Registers it globally; the module manifest lists it for ownership. */
export function defineEntity<const F extends FieldMap>(cfg: EntityConfig<F>): EntityDef<F, 'entity'> {
  return build<F, 'entity'>('entity', cfg, undefined);
}

/** Declares a business document with the docstatus lifecycle (ADR-0006). */
export function defineDocument<const F extends FieldMap>(cfg: DocumentConfig<F>): EntityDef<F, 'document'> {
  if (!cfg.naming) throw new Error(`document ${cfg.name}: naming is required`);
  for (const [name, t] of Object.entries(cfg.transitions ?? {})) {
    if (!((t.from === 0 && t.to === 1) || (t.from === 1 && t.to === 2)))
      throw new Error(
        `document ${cfg.name}: transition ${name} must move draft→submitted or submitted→cancelled; use amend to create a draft`,
      );
  }
  return build<F, 'document'>('document', cfg, cfg);
}
