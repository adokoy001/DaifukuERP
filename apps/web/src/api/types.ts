// Types copied BY HAND from the kernel (kernel/src/meta.ts, dsl/types.ts, errors.ts, i18n.ts, audit.ts) and from
// apps/api (routes/meta.ts ActionSchemaMeta, routes/settings.ts SettingOut) and docs/conventions/reports.md (TableResult).
// The web app is a browser bundle and must not import @daifuku/kernel (it pulls in drizzle/postgres).
// Keep these in sync when the kernel changes; the API serialises Decimal -> string and Date -> ISO string.

export type Locale = 'ja' | 'en';

export interface Label {
  ja: string;
  en: string;
}

export const OPS = ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend', 'export'] as const;
export type Op = (typeof OPS)[number];

export const DOCSTATUS = { draft: 0, submitted: 1, cancelled: 2 } as const;
export type Docstatus = (typeof DOCSTATUS)[keyof typeof DOCSTATUS];

export type FieldKind = 'text' | 'int' | 'decimal' | 'bool' | 'date' | 'timestamp' | 'enum' | 'ref' | 'json' | 'uuid';

export interface FieldMeta {
  name: string;
  /** One of FieldKind; typed as string because the kernel may add kinds before this copy is updated. */
  kind: string;
  label: Label;
  description?: Label;
  required: boolean;
  hasDefault: boolean;
  /** Public inputs must omit server-owned or read-only fields. */
  serverOwned?: boolean;
  readOnly?: boolean;
  /** Literal default supplied by metadata; functions are never serialized. */
  defaultValue?: unknown;
  values?: readonly string[];
  valueLabels?: Record<string, Label>;
  ref?: string;
  refDisplayField?: string;
  hidden: boolean;
  immutable: boolean;
  multiline?: boolean;
  /** Display scale. Money without an explicit scale: the company currency's minor units (6 when the API had no currency). */
  scale?: number;
  /** A money amount (`f.money`), as opposed to a quantity/rate decimal (ADR-0014). */
  money?: boolean;
  /** Ext text field that takes part in the generic search. */
  searchable?: boolean;
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
  /** Registered ext fields (ADR-0014): `name` is `ext.<key>`, values live at `row.ext[key]`. Optional for older APIs. */
  extFields?: FieldMeta[];
  views: { list: string[]; form: 'auto' | string[][]; search: string[] };
  ops: Op[];
  allowOnSubmit?: string[];
  transitions?: string[];
  /** Line entities (伝票明細) of a document, rendered as editable grids (web-phase1 AC-1). */
  lines?: LineSpec[];
}

export interface LineSpec {
  entity: string;
  parentField: string;
}

export interface MenuItem {
  label: Label;
  entity?: string;
  route?: string;
  order?: number;
}

export interface ModuleMeta {
  name: string;
  label: Label;
  menus: MenuItem[];
}

/** Minimal JSON Schema (draft 2020-12 subset) as produced by zod's `toJSONSchema` on the API side. */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  format?: string;
  default?: unknown;
  description?: string;
  title?: string;
  minimum?: number;
  maximum?: number;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  nullable?: boolean;
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
}

export type ResultKind = 'table' | 'record' | 'other';

export interface ActionMeta {
  name: string;
  module: string;
  description: Label;
  generic: boolean;
  mutates: boolean;
  /** Fresh server-side export authorization; absent means unavailable. */
  canExport?: boolean;
  /** 'table' when the output is a TableResult (reports), 'record' for entity outputs. */
  resultKind: ResultKind;
  /** JSON Schema of the input; module actions only. */
  inputSchema?: JsonSchema;
}

export interface AppMeta {
  entities: EntityMeta[];
  modules: ModuleMeta[];
  actions: ActionMeta[];
  roles: string[];
}

// ---- reports (docs/conventions/reports.md) ------------------------------------------------

export type TableColumnKind = 'text' | 'decimal' | 'int' | 'date' | 'ref' | 'bool';

export interface TableColumn {
  key: string;
  label: Label;
  kind: TableColumnKind;
  ref?: string;
  align?: 'left' | 'right';
}

export interface TableResult {
  title: Label;
  columns: TableColumn[];
  /** Decimal cells are strings. */
  rows: Record<string, unknown>[];
  totals?: Record<string, string>;
  meta?: Record<string, unknown>;
}

// ---- settings (apps/api/src/routes/settings.ts) --------------------------------------------

export interface SettingMeta {
  key: string;
  label: Label;
  description?: Label;
  schema: JsonSchema;
  /** null when unset. */
  value: unknown;
}

export type ErrorCode =
  'VALIDATION' | 'PERMISSION_DENIED' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID_STATE' | 'HAS_DEPENDENTS' | 'INTERNAL';

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  hint: string;
  details?: Record<string, unknown>;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

/** A record as returned by the API: system fields plus the entity's own fields (Decimal as string, Date as ISO). */
export interface RecordJson {
  id: string;
  tenantId: string;
  companyId: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  version: number;
  ext?: Record<string, unknown> | null;
  docstatus?: Docstatus;
  number?: string | null;
  amendedFrom?: string | null;
  /** Documents with lines: `<lineEntity>` -> rows (kernel lines.ts, ordered by seq). */
  lines?: Record<string, RecordJson[]>;
  [field: string]: unknown;
}

export interface ListResponse {
  items: RecordJson[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditEntry {
  id: string;
  op: string;
  actorType: string;
  actorId: string;
  onBehalfOf: string | null;
  action: string | null;
  requestId: string | null;
  at: string;
  before: unknown;
  after: unknown;
}

export interface LoginUser {
  tenantAdmin?: boolean;
  accessScope?: 'all' | 'stores' | 'sites';
  storeIds?: string[];
  siteIds?: string[];
  id: string;
  name: string;
  email: string;
  roles: string[];
  tenantId: string;
  defaultCompanyId: string | null;
}

export interface LoginResponse {
  token: string;
  user: LoginUser;
}

// ---- attachments (docs/specs/attachments.md) ------------------------------------------------

/** Row of the `attachment` entity; the API returns it as a RecordJson with these known fields. */
export interface AttachmentJson extends RecordJson {
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  kind: string;
  txnDate: string | null;
  amount: string | null;
  partnerId: string | null;
  linkedEntity: string | null;
  linkedId: string | null;
  note: string | null;
  supersededById: string | null;
}
