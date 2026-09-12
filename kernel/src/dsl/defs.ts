// Definition types shared by the DSL builders and the registry (kept import-cycle free: types only).
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type { Context } from '../context.ts';
import type { EntitySchemas } from '../db/zod.ts';
import type { Label } from '../i18n.ts';
import type { FieldMap, RowOf, InsertOf, UpdateOf } from './fields.ts';
import type { DocumentConfig, DocumentFields, EntityConfig, Op, SystemFields } from './types.ts';

// ---- entities ----------------------------------------------------------------------------------

export interface EntityDef<F extends FieldMap = FieldMap, K extends 'entity' | 'document' = 'entity' | 'document'> {
  readonly kind: K;
  readonly name: string;
  readonly config: EntityConfig<F>;
  /** Present for documents only. */
  readonly doc: DocumentConfig<F> | undefined;
  readonly table: PgTable;
  readonly columns: Record<string, PgColumn>;
  readonly columnNames: Record<string, string>;
  readonly schemas: EntitySchemas;
  readonly fieldNames: readonly string[];
  readonly displayField: string | undefined;
  readonly scope: 'company' | 'tenant';
  readonly hasExt: boolean;
  readonly audit: 'none' | 'full';
  /** Set by defineModule. */
  module: string | undefined;
  col(name: string): PgColumn;
  readonly __row?: RowOf<F>;
}

export type Infer<E> = E extends EntityDef<infer F, infer K>
  ? RowOf<F> & SystemFields & (K extends 'document' ? DocumentFields : Record<never, never>)
  : never;
export type InsertInput<E> = E extends EntityDef<infer F, 'entity' | 'document'> ? InsertOf<F> & { ext?: Record<string, unknown> } : never;
export type UpdateInput<E> = E extends EntityDef<infer F, 'entity' | 'document'> ? UpdateOf<F> & { ext?: Record<string, unknown> } : never;

// ---- actions -----------------------------------------------------------------------------------

export type ActionPermission =
  /** Any authenticated context. */
  | 'authenticated'
  /** Requires the given operation on the entity (checked through the same permission engine as the repository). */
  | { entity: string; op: Op }
  /** Requires one of the roles. */
  | { roles: readonly string[] };

export interface ActionConfig<I extends z.ZodType, O extends z.ZodType> {
  /** Explicitly reviewed for a store-limited context. Generic CRUD uses its entity policy. */
  storeAccess?: boolean;
  /** Explicitly supported by generic site contexts; all repository boundaries still apply. */
  siteAccess?: boolean;
  /** All entities read by a custom report, required for fresh CSV authorization. */
  exportEntities?: readonly string[];
  /** `<module>.<verb_object>`, e.g. `sales.confirm_order`. Becomes POST /actions/<name> and MCP tool <module>_<verb_object>. */
  name: string;
  description: Label;
  input: I;
  output: O;
  permission: ActionPermission;
  /** `required` (default): run inside the request transaction. `none`: read-only, may run outside. */
  tx?: 'required' | 'none';
  /** Hint for agents/UI: does this action change data? */
  mutates?: boolean;
  /**
   * `strict` (default): input is validated against `input` before the handler runs.
   * `lenient`: only shape-checked (must be an object); the handler validates — used by generic create/update so
   * entity `before_validate` hooks can supply defaults for required fields (the schema still documents the API).
   */
  inputMode?: 'strict' | 'lenient';
  /**
   * `true`: in-process only (another module calls it through `runAction` or its exported function). Apps leave it out of
   * `/actions/*`, REST sugar, OpenAPI, `/meta` and MCP tools (ADR-0014). Default false.
   */
  internal?: boolean;
  handler: (ctx: Context, input: z.output<I>) => Promise<z.input<O>>;
}

export interface ActionDef<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> extends ActionConfig<I, O> {
  readonly kind: 'action';
  readonly tx: 'required' | 'none';
  readonly mutates: boolean;
  readonly internal: boolean;
  /** Set by defineModule when listed, or derived from the name prefix. */
  module: string;
  /** Generic entity CRUD actions are marked so UIs can group them. */
  readonly generic: boolean;
}

// ---- modules -----------------------------------------------------------------------------------

export interface MenuItem {
  label: Label;
  /** Entity to open in the generic list view, or a custom route. */
  entity?: string;
  route?: string;
  order?: number;
}

export interface ModuleConfig {
  /** snake_case; also the action name prefix. */
  name: string;
  label: Label;
  /** Names of modules this one depends on (must be imported/registered first). */
  depends: readonly string[];
  entities: readonly EntityDef[];
  actions?: readonly ActionDef[];
  /** Called once at registration; register hooks/overrides/guards/subscriptions here. */
  hooks?: () => void;
  /** Idempotent seed data for a new company. */
  seed?: (ctx: Context) => Promise<void>;
  menus?: readonly MenuItem[];
  /** Roles this module introduces (for docs/UI). */
  roles?: Record<string, Label>;
}

export interface ModuleDef extends ModuleConfig {
  readonly kind: 'module';
}

// ---- packs (ADR-0015) --------------------------------------------------------------------------

/** UI label overrides for one entity (global: every tenant/company sees them; ADR-0015). */
export interface LabelOverride {
  entity?: Label;
  /** Entity field name -> label. Ext fields carry their own label in the ext definition. */
  fields?: Readonly<Record<string, Label>>;
}

export interface PackConfig {
  /** snake_case; the action name prefix and the ext source `pack:<name>`. Must not clash with a module name. */
  name: string;
  label: Label;
  /** Recorded in the company setting `packs.applied`. Default `0.0.0`. */
  version?: string;
  /** Modules or packs that must already be registered (import them first). Extended entities' modules must be reachable from here. */
  depends: readonly string[];
  /** entity name -> ext fields, registered with registry.registerExt(…, { source: `pack:<name>` }) at definition time. */
  ext?: Readonly<Record<string, FieldMap>>;
  /** Small entities the pack owns (defined with defineEntity; appear in /meta, migrations and generic CRUD actions). */
  entities?: readonly EntityDef[];
  /** Actions named `<pack>.<verb_object>`. */
  actions?: readonly ActionDef[];
  /** Called once at definition: hooks, overrides, guards, subscriptions, registerSetting. */
  hooks?: () => void;
  /** Company setting defaults written by applyPack for keys the company has not set (keys must be registered settings). */
  settings?: Readonly<Record<string, unknown>>;
  /** entity name -> label overrides exposed through /meta. */
  labels?: Readonly<Record<string, LabelOverride>>;
  menus?: readonly MenuItem[];
  /** Idempotent masters for a company (run by applyPack). */
  seed?: (ctx: Context) => Promise<void>;
  /** Demo data (applyPack with `sample: true`); runs once per company unless forced. */
  sample?: (ctx: Context) => Promise<void>;
  /** Roles this pack introduces (for docs/UI). */
  roles?: Record<string, Label>;
}

export interface PackDef extends PackConfig {
  readonly kind: 'pack';
  readonly version: string;
}
