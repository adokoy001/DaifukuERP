// Process-wide registry of modules, packs, entities, actions, hooks, overrides, guards and event subscriptions.
// Modules and packs register by calling defineEntity/defineAction/defineModule/definePack at import time; apps read from here.
import type { PgTable } from 'drizzle-orm/pg-core';
import { getTableColumns } from 'drizzle-orm';
import { buildTable, type RefResolver } from './db/table.ts';
import type { z } from 'zod';
import type { ActionDef, EntityDef, LabelOverride, ModuleDef, PackDef } from './dsl/defs.ts';
import { checkExtFields, DEFAULT_EXT_SOURCE, type ExtFieldDef, type RegisterExtOptions } from './dsl/ext.ts';
import type { FieldMap } from './dsl/fields.ts';
import type { Context } from './context.ts';
import { Conflict, DependencyError } from './errors.ts';
import type { Label } from './i18n.ts';
import type { LocalDate } from './ids.ts';
import { packIsActive } from './pack-scope.ts';

export const HOOK_PHASES = [
  'before_validate',
  'before_create',
  'after_create',
  'before_update',
  'after_update',
  'before_delete',
  'after_delete',
  'before_submit',
  'after_submit',
  'before_cancel',
  'after_cancel',
  /** Document only: once per saveLines call, after every line set is replaced (ADR-0014). */
  'after_lines_saved',
] as const;
export type HookPhase = (typeof HOOK_PHASES)[number];

export interface HookArgs {
  entity: string;
  /** Optional effective date explicitly supplied for a cancellation/correction. */
  correctionDate?: LocalDate;
  /** Current row (after change for after_* phases). Mutable in before_* phases. after_lines_saved: the parent, re-read. */
  row: Record<string, unknown>;
  /** Previous row for update/delete/submit/cancel phases. */
  previous?: Record<string, unknown>;
  /** after_lines_saved only: every line set of the document after the save (lineEntity -> rows, seq order, Decimal values). */
  lines?: Record<string, Record<string, unknown>[]>;
}
export type HookFn = (ctx: Context, args: HookArgs) => Promise<void> | void;
export type GuardFn = (ctx: Context, row: Record<string, unknown>) => Promise<boolean> | boolean;
export type OverrideFn = (...args: never[]) => unknown;
export type EventHandler = (ctx: Context, payload: unknown, meta: { topic: string; id: string }) => Promise<void>;

/**
 * A company setting declared by a module (ADR-0013 L1). `key` is `<module>.<name>`; `schema` validates the value
 * stored in companies.settings (see settings.ts getSetting/setSetting) and is what the generic settings UI renders.
 */
export interface RegistryWarning {
  kind: 'label_override';
  message: string;
}

export interface SettingDef<T = unknown> {
  key: string;
  label: Label;
  description?: Label;
  schema: z.ZodType<T>;
  /**
   * The value the module uses when the company has none. Declaring it lets applyPack treat a stored value equal to
   * it (e.g. written by an l10n seed) as "still the default" and replace it with the pack's default (ADR-0015).
   */
  default?: T;
}

class Registry {
  private modules = new Map<string, ModuleDef>();
  private entities = new Map<string, EntityDef>();
  private actionDefs = new Map<string, ActionDef>();
  private hooks = new Map<string, HookFn[]>();
  private overrides = new Map<string, OverrideFn>();
  private guards = new Map<string, GuardFn>();
  private subscriptions = new Map<string, EventHandler[]>();
  private systemTables = new Map<string, PgTable>();
  private registrationSource: string | undefined;
  private settings = new Map<string, SettingDef>();
  private ext = new Map<string, Map<string, ExtFieldDef>>();
  /** entity -> stamp of its last ext registration. Stamps only grow (also across reset) so caches keyed by them stay valid. */
  private extVersions = new Map<string, number>();
  private extStamp = 0;
  private packDefs = new Map<string, PackDef>();
  /** entity -> merged label overrides, plus which pack set each label (for conflict hints). */
  private labels = new Map<
    string,
    { override: { entity?: Label; fields: Record<string, Label> }; sources: Map<string, string> }
  >();
  private warningList: RegistryWarning[] = [];

  registerEntity(def: EntityDef): void {
    if (this.entities.has(def.name))
      throw new Error(`entity "${def.name}" is already registered (names are global; pick a unique snake_case name)`);
    this.entities.set(def.name, def);
  }
  entity(name: string): EntityDef {
    const e = this.entities.get(name);
    if (!e) throw new Error(`entity "${name}" is not registered. Import the module that defines it before use.`);
    return e;
  }
  hasEntity(name: string): boolean {
    return this.entities.has(name);
  }
  allEntities(): EntityDef[] {
    return [...this.entities.values()];
  }

  registerAction(def: ActionDef): void {
    if (this.actionDefs.has(def.name)) throw new Error(`action "${def.name}" is already registered`);
    this.actionDefs.set(def.name, def);
  }
  action(name: string): ActionDef {
    const a = this.actionDefs.get(name);
    if (!a) throw new Error(`action "${name}" is not registered`);
    return a;
  }
  hasAction(name: string): boolean {
    return this.actionDefs.has(name);
  }
  /** Every action, internal ones included (in-process callers, registry inspection). */
  allActions(): ActionDef[] {
    return [...this.actionDefs.values()];
  }
  /** Actions apps expose (REST, OpenAPI, /meta, MCP): internal ones are left out unless `includeInternal` (ADR-0014). */
  actions(opts: { includeInternal?: boolean } = {}): ActionDef[] {
    const all = [...this.actionDefs.values()];
    return opts.includeInternal === true ? all : all.filter((a) => !a.internal);
  }

  /**
   * Declares typed keys for an entity's JSONB `ext` (ADR-0003/0014). Same `f.*` builders as entities.
   * Unknown entity -> DependencyError; key collisions -> ValidationError; key already registered -> Conflict.
   */
  registerExt(entityName: string, fields: FieldMap, opts: RegisterExtOptions = {}): void {
    const source = opts.source ?? this.registrationSource ?? DEFAULT_EXT_SOURCE;
    const entity = this.entities.get(entityName);
    if (!entity) {
      throw new DependencyError(entityName, '', [], {
        message: `registerExt: entity "${entityName}" is not registered (source "${source}")`,
        hint: `Import the module that defines "${entityName}" before registering ext fields on it, and list that module in your pack's depends.`,
      });
    }
    const current = this.ext.get(entityName) ?? new Map<string, ExtFieldDef>();
    const added = checkExtFields(entity, fields, current, source);
    for (const def of added) current.set(def.key, def);
    this.ext.set(entityName, current);
    this.extStamp += 1;
    this.extVersions.set(entityName, this.extStamp);
  }
  /** Registered ext fields of an entity, in registration order. */
  extFields(entityName: string): readonly ExtFieldDef[] {
    return [...(this.ext.get(entityName)?.values() ?? [])];
  }
  /** Changes whenever ext fields are registered for the entity (0 = none). Used to invalidate derived schemas. */
  extVersion(entityName: string): number {
    return this.extVersions.get(entityName) ?? 0;
  }

  registerModule(def: ModuleDef): void {
    if (this.modules.has(def.name)) throw new Error(`module "${def.name}" is already registered`);
    for (const dep of def.depends) {
      if (!this.modules.has(dep))
        throw new Error(
          `module "${def.name}" depends on "${dep}" which is not registered yet. Import dependencies first (see docs/conventions/layers.md).`,
        );
    }
    this.modules.set(def.name, def);
  }
  hasModule(name: string): boolean {
    return this.modules.has(name);
  }
  module(name: string): ModuleDef {
    const m = this.modules.get(name);
    if (!m) throw new Error(`module "${name}" is not registered`);
    return m;
  }
  allModules(): ModuleDef[] {
    return [...this.modules.values()];
  }

  /** Names in `depends` that are neither a registered module nor a registered pack. */
  missingDependencies(depends: readonly string[]): string[] {
    return depends.filter((d) => !this.modules.has(d) && !this.packDefs.has(d));
  }

  /**
   * Registers a pack manifest and its label overrides (ADR-0015). definePack calls this after its own checks.
   * Name taken by a module/pack -> Conflict; missing depends -> DependencyError; a label already overridden by another
   * pack -> the later pack wins and a warning is recorded.
   */
  registerPack(def: PackDef): void {
    if (this.packDefs.has(def.name) || this.modules.has(def.name)) {
      throw new Conflict(
        `pack "${def.name}": the name is already registered as a ${this.modules.has(def.name) ? 'module' : 'pack'}`,
        'Pack and module names share one namespace (action prefixes). Rename the pack.',
        { pack: def.name },
      );
    }
    const missing = this.missingDependencies(def.depends);
    if (missing.length > 0) {
      throw new DependencyError(`pack:${def.name}`, '', [], {
        message: `pack "${def.name}" depends on ${missing.map((m) => `"${m}"`).join(', ')} which ${missing.length === 1 ? 'is' : 'are'} not registered`,
        hint: `Import the module/pack package(s) providing ${missing.join(', ')} before the pack (apps: modules -> l10n -> packs), or fix the names in depends.`,
      });
    }
    // Label overrides are global and cosmetic (ADR-0015): when two loaded packs relabel the same entity/field the
    // later pack wins and the overlap is recorded as a warning (apps log registry.warnings() at startup).
    for (const t of this.labelConflicts(def)) {
      this.warningList.push({
        kind: 'label_override',
        message: `pack "${def.name}" relabels ${t.path}, replacing the label set by "${t.source}"`,
      });
    }
    this.packDefs.set(def.name, def);
    for (const [entity, o] of Object.entries(def.labels ?? {})) this.mergeLabels(entity, o, def.name);
  }
  /** Non-fatal registration overlaps (currently: pack label overrides replaced by a later pack). */
  warnings(): readonly RegistryWarning[] {
    return this.warningList;
  }
  hasPack(name: string): boolean {
    return this.packDefs.has(name);
  }
  pack(name: string): PackDef | undefined {
    return this.packDefs.get(name);
  }
  packs(): PackDef[] {
    return [...this.packDefs.values()];
  }
  /** Label overrides registered by packs for an entity (undefined when none). */
  labelOverrides(entity: string, appliedPacks?: readonly string[]): LabelOverride | undefined {
    if (appliedPacks) {
      let selected: LabelOverride | undefined;
      for (const pack of this.packDefs.values()) {
        const next = appliedPacks.includes(pack.name) ? pack.labels?.[entity] : undefined;
        if (next) selected = { ...selected, ...next, fields: { ...selected?.fields, ...next.fields } };
      }
      return selected;
    }
    return this.labels.get(entity)?.override;
  }

  private labelConflicts(def: PackDef): { path: string; source: string }[] {
    const out: { path: string; source: string }[] = [];
    for (const [entity, o] of Object.entries(def.labels ?? {})) {
      const sources = this.labels.get(entity)?.sources;
      if (!sources) continue;
      const paths = [...(o.entity ? [entity] : []), ...Object.keys(o.fields ?? {}).map((f) => `${entity}.${f}`)];
      for (const path of paths) {
        const source = sources.get(path);
        if (source) out.push({ path, source });
      }
    }
    return out;
  }
  private mergeLabels(entity: string, o: LabelOverride, source: string): void {
    const cur = this.labels.get(entity) ?? { override: { fields: {} }, sources: new Map<string, string>() };
    if (o.entity) {
      cur.override.entity = o.entity;
      cur.sources.set(entity, source);
    }
    for (const [field, l] of Object.entries(o.fields ?? {})) {
      cur.override.fields[field] = l;
      cur.sources.set(`${entity}.${field}`, source);
    }
    this.labels.set(entity, cur);
  }

  registerHook(entity: string, phase: HookPhase, fn: HookFn): void {
    const key = `${entity}:${phase}`;
    const list = this.hooks.get(key) ?? [];
    const source = this.registrationSource;
    list.push(
      source
        ? async (ctx, args) => {
            if (packIsActive(ctx, source)) await fn(ctx, args);
          }
        : fn,
    );
    this.hooks.set(key, list);
  }
  hooksFor(entity: string, phase: HookPhase): readonly HookFn[] {
    return this.hooks.get(`${entity}:${phase}`) ?? [];
  }

  /** Tag registrations made by definePack.hooks so runtime activation follows the selected company. */
  withRegistrationSource(source: string, register: () => void): void {
    const previous = this.registrationSource;
    this.registrationSource = source;
    try {
      register();
    } finally {
      this.registrationSource = previous;
    }
  }

  /** Overrides are named replacement points a core module explicitly exposes (ADR-0008). */
  registerOverride(point: string, fn: OverrideFn): void {
    this.overrides.set(point, fn);
  }
  override<T extends OverrideFn>(point: string, fallback: T): T {
    return (this.overrides.get(point) as T | undefined) ?? fallback;
  }

  registerGuard(name: string, fn: GuardFn): void {
    const source = this.registrationSource;
    this.guards.set(name, source ? (ctx, row) => (packIsActive(ctx, source) ? fn(ctx, row) : true) : fn);
  }
  guard(name: string): GuardFn {
    const g = this.guards.get(name);
    if (!g) throw new Error(`guard "${name}" is not registered`);
    return g;
  }

  subscribe(topic: string, handler: EventHandler): void {
    const list = this.subscriptions.get(topic) ?? [];
    const source = this.registrationSource;
    list.push(
      source
        ? async (ctx, payload, meta) => {
            if (packIsActive(ctx, source)) await handler(ctx, payload, meta);
          }
        : handler,
    );
    this.subscriptions.set(topic, list);
  }
  subscribersFor(topic: string): readonly EventHandler[] {
    return this.subscriptions.get(topic) ?? [];
  }

  /** Declares a company setting so apps can list/edit it generically (GET/PUT /meta/settings). */
  registerSetting<T>(def: SettingDef<T>): void {
    if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(def.key))
      throw new Error(`setting key "${def.key}" must look like "<module>.<name>" in snake_case`);
    if (this.settings.has(def.key)) throw new Error(`setting "${def.key}" is already registered`);
    this.settings.set(def.key, def as SettingDef);
  }
  hasSetting(key: string): boolean {
    return this.settings.has(key);
  }
  setting(key: string): SettingDef {
    const s = this.settings.get(key);
    if (!s)
      throw new Error(
        `setting "${key}" is not registered. Declare it with registry.registerSetting in the owning module.`,
      );
    return s;
  }
  allSettings(): SettingDef[] {
    return [...this.settings.values()];
  }

  registerSystemTable(name: string, table: PgTable): void {
    this.systemTables.set(name, table);
  }
  /** Schema-only tables include generated equality columns after every pack is loaded; runtime tables stay intact. */
  tables(): Record<string, PgTable> {
    const out: Record<string, PgTable> = {};
    for (const [name, t] of this.systemTables) out[name] = t;
    const resolveRef: RefResolver = (name, column = 'id') => {
      if (name === '@company') {
        const company = this.systemTables.get('companies');
        return company ? getTableColumns(company)[column] : undefined;
      }
      return this.entity(name).columns[column];
    };
    for (const e of this.entities.values()) {
      const ext = this.extFields(e.name);
      const indexed = ext.some((def) => (def.field.opts as { equalityIndex?: boolean }).equalityIndex === true);
      out[e.name] = indexed ? buildTable(e.config, e.kind, resolveRef, ext).table : e.table;
    }
    return out;
  }

  /** Test-only: forget everything. */
  reset(): void {
    this.modules.clear();
    this.entities.clear();
    this.actionDefs.clear();
    this.hooks.clear();
    this.overrides.clear();
    this.guards.clear();
    this.subscriptions.clear();
    this.settings.clear();
    this.ext.clear();
    this.extVersions.clear();
    this.packDefs.clear();
    this.labels.clear();
    this.warningList = [];
  }
}

export const registry = new Registry();
