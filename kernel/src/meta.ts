// UI/agent metadata derived from definitions (ADR-0002): what the generic UI renders and what MCP lists.
import type { Context } from './context.ts';
import type { EntityDef } from './dsl/entity.ts';
import { EXT_PREFIX } from './dsl/ext.ts';
import type { AnyField } from './dsl/fields.ts';
import type { Label } from './i18n.ts';
import type { Op } from './dsl/types.ts';
import { allowedOps, maskedFields } from './permissions.ts';
import { registry } from './registry.ts';
import { currencyScale } from './settings.ts';
import { canExportAction, canRunAction } from './actions/run.ts';

export interface FieldMeta {
  /** Field name; `ext.<key>` for registered ext fields (EntityMeta.extFields). */
  name: string;
  kind: string;
  label: Label;
  description?: Label;
  required: boolean;
  hasDefault: boolean;
  serverOwned: boolean;
  readOnly: boolean;
  defaultValue?: unknown;
  values?: readonly string[];
  valueLabels?: Record<string, Label>;
  ref?: string;
  refDisplayField?: string;
  hidden: boolean;
  immutable: boolean;
  multiline?: boolean;
  /** Display scale. Money fields without an explicit scale: the company currency's minor units when known (else 6). */
  scale?: number;
  /** A money amount (`f.money`), as opposed to a quantity/rate decimal. */
  money?: true;
  /** Ext text field that takes part in the generic search. */
  searchable?: true;
  /** Ext fields: who registered it (registry.registerExt `source`). */
  source?: string;
}

export interface EntityMeta {
  name: string;
  kind: 'entity' | 'document';
  label: Label;
  module: string | undefined;
  scope: 'company' | 'tenant';
  displayField: string | undefined;
  hasExt: boolean;
  fields: FieldMeta[];
  /** Registered ext fields (ADR-0014), values live at `row.ext[key]`; `name` is `ext.<key>`. Empty when none. */
  extFields: FieldMeta[];
  views: { list: string[]; form: 'auto' | string[][]; search: string[] };
  ops: Op[];
  allowOnSubmit?: string[];
  transitions?: string[];
  /** Line entities (伝票明細) of a document, rendered as editable grids by the generic UI. */
  lines?: { entity: string; parentField: string }[];
}

export interface MetaOptions {
  /** ISO 4217 code of the caller's company (apps resolve it with findCompany); money fields take its display scale. */
  currency?: string;
  /** Packs applied to the caller's company (apps: `Object.keys(appliedPacksOf(company.settings))`); AppMeta.packs[].applied. */
  appliedPacks?: readonly string[];
}

/** numeric(20,6): the scale money fields reported before the currency was known. */
const STORAGE_SCALE = 6;

function humanize(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function describeField(name: string, fd: AnyField, opts: MetaOptions): FieldMeta {
  const o = fd.opts as Record<string, unknown>;
  const labelName = name.startsWith(EXT_PREFIX) ? name.slice(EXT_PREFIX.length) : name;
  const meta: FieldMeta = {
    name,
    kind: fd.kind,
    label: (o.label as Label | undefined) ?? { ja: humanize(labelName), en: humanize(labelName) },
    required: fd.required,
    hasDefault: fd.hasDefault,
    serverOwned: o.serverOwned === true,
    readOnly: o.serverOwned === true,
    hidden: o.hidden === true,
    immutable: o.immutable === true,
  };
  if (o.description) meta.description = o.description as Label;
  if (fd.hasDefault && !['date', 'timestamp', 'uuid'].includes(fd.kind)) meta.defaultValue = o.default;
  if (fd.values) meta.values = fd.values;
  if (o.labels) meta.valueLabels = o.labels as Record<string, Label>;
  if (fd.ref) {
    meta.ref = fd.ref;
    const target = registry.hasEntity(fd.ref) ? registry.entity(fd.ref) : undefined;
    const df = (o.displayField as string | undefined) ?? target?.displayField;
    if (df && !target?.config.fields[df]?.opts.outputHidden) meta.refDisplayField = df;
  }
  if (o.multiline) meta.multiline = true;
  if (typeof o.scale === 'number') meta.scale = o.scale;
  if (fd.kind === 'decimal' && o.money === true) {
    meta.money = true;
    if (typeof o.scale !== 'number') meta.scale = opts.currency ? currencyScale(opts.currency) : STORAGE_SCALE;
  }
  return meta;
}

export function fieldMeta(entity: EntityDef, name: string, opts: MetaOptions = {}): FieldMeta {
  const fd = entity.config.fields[name];
  if (!fd || fd.opts.outputHidden) throw new Error(`no public field ${name}`);
  const meta = describeField(name, fd, opts);
  const override = registry.labelOverrides(entity.name, opts.appliedPacks)?.fields?.[name];
  if (override) meta.label = override;
  return meta;
}

/** AC-3 (ADR-0014): registered ext fields as `ext.<key>` FieldMeta. */
export function extFieldMetas(entity: EntityDef, opts: MetaOptions = {}): FieldMeta[] {
  if (!entity.hasExt) return [];
  return registry
    .extFields(entity.name)
    .filter(
      (d) =>
        !d.field.opts.outputHidden &&
        (!opts.appliedPacks || !d.source.startsWith('pack:') || opts.appliedPacks.includes(d.source.slice(5))),
    )
    .map((d) => {
      const meta = describeField(`${EXT_PREFIX}${d.key}`, d.field, opts);
      if ((d.field.opts as { searchable?: boolean }).searchable === true) meta.searchable = true;
      meta.source = d.source;
      return meta;
    });
}

export function entityMeta(ctx: Context, entity: EntityDef, opts: MetaOptions = {}): EntityMeta {
  opts = {
    ...opts,
    ...(opts.appliedPacks === undefined && ctx.appliedPacks !== undefined ? { appliedPacks: ctx.appliedPacks } : {}),
  };
  const masked = maskedFields(ctx, entity);
  const visible = entity.fieldNames.filter((f) => !masked.has(f) && !entity.config.fields[f]?.opts.outputHidden);
  const views = entity.config.views;
  const nonHidden = visible.filter((f) => !entity.config.fields[f]?.opts.hidden);
  const meta: EntityMeta = {
    name: entity.name,
    kind: entity.kind,
    label: registry.labelOverrides(entity.name, opts.appliedPacks)?.entity ?? entity.config.label,
    module: entity.module,
    scope: entity.scope,
    displayField: entity.displayField && visible.includes(entity.displayField) ? entity.displayField : undefined,
    hasExt: entity.hasExt,
    fields: visible.map((f) => fieldMeta(entity, f, opts)),
    extFields: extFieldMetas(entity, opts),
    views: {
      list: [...(views?.list ?? nonHidden.slice(0, 6))].filter((f) => visible.includes(f)),
      form:
        views?.form && views.form !== 'auto'
          ? views.form.map((g) => [...g].filter((f) => visible.includes(f)))
          : 'auto',
      search: [...(views?.search ?? (entity.displayField ? [entity.displayField] : []))].filter((field) =>
        visible.includes(field),
      ),
    },
    ops: allowedOps(
      {
        roles: ctx.roles,
        appliedPacks: opts.appliedPacks ?? ctx.appliedPacks ?? [],
        ...(ctx.accessScope ? { accessScope: ctx.accessScope } : {}),
      },
      entity,
    ),
  };
  if (entity.doc) {
    meta.allowOnSubmit = [...(entity.doc.allowOnSubmit ?? [])].filter(
      (field) =>
        visible.includes(field) || (field.startsWith('ext.') && meta.extFields.some((ext) => ext.name === field)),
    );
    meta.transitions = Object.keys(entity.doc.transitions ?? {});
    meta.lines = (entity.doc.lines ?? []).map((l) => ({ entity: l.entity, parentField: l.parentField }));
  }
  return meta;
}

export interface AppMeta {
  entities: EntityMeta[];
  /** Modules, then packs (ADR-0015: loaded packs contribute menus and entity groups like modules). */
  modules: { name: string; label: Label; menus: { label: Label; entity?: string; route?: string; order?: number }[] }[];
  /** Exposed actions only: `internal` ones are omitted (ADR-0014). */
  actions: {
    name: string;
    module: string;
    description: Label;
    generic: boolean;
    mutates: boolean;
    canExport: boolean;
  }[];
  roles: string[];
  /** Loaded packs; `applied` for the caller's company comes from MetaOptions.appliedPacks (false when not given). */
  packs: { name: string; label: Label; applied: boolean }[];
}

export function appMeta(ctx: Context, opts: MetaOptions = {}): AppMeta {
  opts = { ...opts, appliedPacks: opts.appliedPacks ?? ctx.appliedPacks ?? [] };
  const scope = {
    roles: ctx.roles,
    appliedPacks: opts.appliedPacks ?? [],
    ...(ctx.accessScope ? { accessScope: ctx.accessScope } : {}),
  };
  const entities = registry
    .allEntities()
    .filter((e) => allowedOps(scope, e).includes('read'))
    .map((e) => entityMeta(ctx, e, opts));
  const modules = [
    ...registry.allModules(),
    ...registry.packs().filter((pack) => opts.appliedPacks?.includes(pack.name)),
  ].map((m) => ({
    name: m.name,
    label: m.label,
    menus: (m.menus ?? [])
      .map((mi) => ({ ...mi }))
      .filter((mi) => !mi.entity || entities.some((e) => e.name === mi.entity)),
  }));
  const effective = Object.create(ctx) as Context;
  Object.defineProperty(effective, 'appliedPacks', { value: opts.appliedPacks ?? [] });
  const actions = registry
    .actions()
    .filter((a) => canRunAction(effective, a))
    .map((a) => ({
      name: a.name,
      module: a.module,
      description: a.description,
      generic: a.generic,
      mutates: a.mutates,
      canExport: canExportAction(effective, a),
    }));
  for (const module of modules)
    module.menus = module.menus.filter(
      (m) =>
        !m.route ||
        !/^\/[ra]\//.test(m.route) ||
        actions.some((a) => m.route === `/r/${a.name}` || m.route === `/a/${a.name}`),
    );
  const applied = new Set(opts.appliedPacks ?? []);
  const packs = registry.packs().map((p) => ({ name: p.name, label: p.label, applied: applied.has(p.name) }));
  return { entities, modules, actions, roles: [...ctx.roles], packs };
}
