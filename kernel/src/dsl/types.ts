// Shared DSL configuration types (entity / document / permissions / views).
import type { Label } from '../i18n.ts';
import type { FieldMap } from './fields.ts';

export const OPS = ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend', 'export'] as const;
export type Op = (typeof OPS)[number];

/** Scalar in a domain expression. `$ctx.*` tokens are substituted from the request context at query time. */
export type DomainScalar = string | number | boolean | null;
/** Multiple operators on one field are conjunctive; empty/unknown/malformed operators are rejected. */
export type DomainCondition =
  | DomainScalar
  | { $in: DomainScalar[] }
  | { $ne: DomainScalar }
  | { $gt: DomainScalar }
  | { $gte: DomainScalar }
  | { $lt: DomainScalar }
  | { $lte: DomainScalar }
  | { $like: string };
/**
 * Domain expression (ADR-0007): `{ field: cond, ... }` is AND of conditions; `$or` / `$and` nest.
 * Example: `{ isCustomer: true, $or: [{ ownerId: '$ctx.userId' }, { ownerId: null }] }`
 * A bounded field range can use `{ amount: { $gte: '100', $lt: '200' } }`, equivalent to explicit `$and`.
 * Timestamp operands are zoned ISO strings with second precision and up to three fractional digits.
 */
export type Domain = { [field: string]: DomainCondition | Domain[] | undefined; $or?: Domain[]; $and?: Domain[] };

export interface RowRule {
  roles: readonly string[];
  where: Domain;
}

export interface FieldGroup {
  fields: readonly string[];
  roles: readonly string[];
}

export interface PermissionConfig {
  /** role -> allowed operations. Roles not listed are denied. `admin` implicitly has every op. */
  roles: Record<string, readonly Op[]>;
  /** Row-level restrictions for the listed roles. A user is restricted only if ALL of their granted roles are restricted. */
  rowRules?: readonly RowRule[];
  /** Field-level restrictions: fields readable/writable only by the listed roles; masked otherwise. */
  fieldGroups?: Record<string, FieldGroup>;
}

export type Naming =
  | {
      type: 'sequence';
      prefix: string;
      /** Sequence key; defaults to the entity name. */
      key?: string;
      scope?: 'company' | 'tenant';
      /** Reset period. `year` uses the business date's calendar year. */
      period?: 'none' | 'year';
      width?: number;
    }
  | { type: 'field'; field: string };

export interface ViewsConfig {
  /** Columns in the generic list view. Defaults to the first 6 non-hidden fields. */
  list?: readonly string[];
  /** Field groups in the generic form. 'auto' = all non-hidden fields in declaration order. */
  form?: 'auto' | readonly (readonly string[])[];
  /** Fields used by the quick search box. */
  search?: readonly string[];
}

export interface EntityConfig<F extends FieldMap = FieldMap> {
  /** Store-limited contexts fail closed unless this policy is declared. */
  storeAccess?: StoreAccessPolicy;
  /** Generic site boundary. Sites scope may also explicitly use legacy storeIds. */
  siteAccess?: StoreAccessPolicy;
  /** snake_case singular, unique across all modules; also the table name. */
  name: string;
  label: Label;
  fields: F;
  /** `company`: rows belong to a company (default). `tenant`: shared across companies. */
  scope?: 'company' | 'tenant';
  naming?: Naming;
  /** Enable the JSONB `ext` column (ADR-0003). Default true. */
  ext?: boolean;
  /** Audit before/after values (ADR-0007). Default 'full'. */
  audit?: 'none' | 'full';
  permissions: PermissionConfig;
  views?: ViewsConfig;
  /** Field shown as the record's title in UI and in ref lookups. Defaults to `name` or `code` if present. */
  displayField?: string;
  /** Composite unique constraints (tenant/company are prepended automatically). */
  unique?: readonly (readonly string[])[];
  indexes?: readonly (readonly string[])[];
}

export type StoreAccessPolicy =
  | { kind: 'store'; field: string }
  | { kind: 'parent'; field: string; entity: string }
  | { kind: 'sharedRead' };

export interface Transition {
  from: 0 | 1 | 2;
  to: 0 | 1 | 2;
  roles?: readonly string[];
  /** Name of a guard registered with registerGuard(); receives the row and context. */
  guard?: string;
}

export interface DocumentConfig<F extends FieldMap = FieldMap> extends EntityConfig<F> {
  naming: Naming;
  /** Fields that may still be updated after submit (ADR-0006). */
  allowOnSubmit?: readonly string[];
  /** Child line entities (each must have a ref field back to this document, given as `parentField`). */
  lines?: readonly { entity: string; parentField: string }[];
  /** Named transitions in addition to the built-in submit/cancel/amend. */
  transitions?: Record<string, Transition>;
}

export const SYSTEM_FIELDS = ['id', 'tenantId', 'companyId', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'version', 'ext'] as const;
export const DOCUMENT_FIELDS = ['docstatus', 'number', 'amendedFrom'] as const;

export interface SystemFields {
  id: string;
  tenantId: string;
  companyId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  version: number;
  ext: Record<string, unknown> | null;
}

export interface DocumentFields {
  /** 0 draft, 1 submitted, 2 cancelled */
  docstatus: 0 | 1 | 2;
  number: string | null;
  amendedFrom: string | null;
}

export const DOCSTATUS = { draft: 0, submitted: 1, cancelled: 2 } as const;
export type Docstatus = (typeof DOCSTATUS)[keyof typeof DOCSTATUS];
