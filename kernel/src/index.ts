// @daifuku/kernel public API. Modules import ONLY from here.
export { Decimal, isDecimal, ROUNDING_MODES, type DecimalInput, type RoundingMode } from './decimal.ts';
export { DaifukuError, ValidationError, PermissionDenied, NotFound, Conflict, StateError, DependencyError, toErrorBody, safeErrorDiagnostics, type ErrorBody, type ErrorCode } from './errors.ts';
export { label, t, type Label, type Locale } from './i18n.ts';
export { newId, isUuid, isLocalDate, todayLocal, type LocalDate } from './ids.ts';
export { toHalfwidthKana, normalizeText } from './normalize.ts';

export { f, type FieldDef, type AnyField, type FieldMap, type RowOf, type InsertOf, type UpdateOf, type ValueOf, type InputValueOf } from './dsl/fields.ts';
export {
  OPS,
  DOCSTATUS,
  SYSTEM_FIELDS,
  DOCUMENT_FIELDS,
  type Op,
  type Domain,
  type DomainCondition,
  type PermissionConfig,
  type RowRule,
  type FieldGroup,
  type Naming,
  type ViewsConfig,
  type EntityConfig,
  type StoreAccessPolicy,
  type DocumentConfig,
  type Transition,
  type SystemFields,
  type DocumentFields,
  type Docstatus,
} from './dsl/types.ts';
export { defineEntity, defineDocument, type EntityDef, type Infer, type InsertInput, type UpdateInput } from './dsl/entity.ts';
export { defineAction, toolNameOf, type ActionDef, type ActionConfig, type ActionPermission } from './dsl/action.ts';
export { defineModule, type ModuleDef, type ModuleConfig, type MenuItem } from './dsl/module.ts';
export { EXT_PREFIX, type ExtFieldDef, type RegisterExtOptions } from './dsl/ext.ts';
export { definePack, packSource, DEFAULT_PACK_VERSION, type PackConfig, type PackDef, type LabelOverride } from './dsl/pack.ts';

export { registry, HOOK_PHASES, type HookPhase, type HookFn, type HookArgs, type GuardFn, type EventHandler, type SettingDef, type RegistryWarning } from './registry.ts';
export { type Context, type ContextParams, type Actor, type Logger, type Db, ADMIN_ROLE, isAdmin, consoleLogger } from './context.ts';
export { connect, withContext, makeContext, systemParams, type Database } from './db/client.ts';
export { tenants, companies, users, companyMemberships, sequences, auditLog, outbox, extFieldDefinitions } from './db/system-tables.ts';
export { runMigrations, enforcePolicies, dropAll } from './db/migrate.ts';
export { currentSnapshot, emptySnapshot, diffSql, createSchemaFromScratch, type Snapshot } from './db/schema-sync.ts';
export { APP_ROLE, TENANT_SETTING, toSnake } from './db/table.ts';

export { repo, Repository, type ListResult } from './repository/repository.ts';
export { listQuerySchema, type ListQuery } from './repository/query.ts';
export { aggregate, type AggregateQuery, type AggregateRow, type Metric } from './repository/aggregate.ts';
export { getLines, saveLines, lineSpecs, isSavingLines, type LinesInput, type LinesResult } from './lines.ts';
export { getCompany, findCompany, getSetting, setSetting, currencyScale, DEFAULT_CURRENCY_SCALE, type CompanyInfo } from './settings.ts';
export { configureStorage, storage, LocalStorage, type StoragePort, type StoredObject } from './storage.ts';
export { snapshot } from './repository/rows.ts';
export { submitDocument, cancelDocument, amendDocument, transitionDocument, findDependents } from './document.ts';
export { nextNumber } from './numbering.ts';
export { writeAudit, auditTrail, type AuditEntry } from './audit.ts';
export { deliverPending, type DeliveryResult } from './events.ts';
export { can, assertOp, allowedOps, rowFilter, compileDomain, maskedFields, grantedRoles } from './permissions.ts';
export { registerCrudActions } from './actions/crud.ts';
export { registerPackActions } from './actions/pack.ts';
export { applyPack, readAppliedPacks, appliedPacksOf, ensurePackSettings, PACKS_APPLIED_KEY, appliedPacksSchema, type ApplyPackOptions, type ApplyPackResult, type AppliedPack, type AppliedPacks } from './pack.ts';
export { runAction, checkActionPermission, checkActionExport, canExportAction, canRunAction } from './actions/run.ts';
export { entityMeta, appMeta, fieldMeta, extFieldMetas, type EntityMeta, type FieldMeta, type AppMeta, type MetaOptions } from './meta.ts';
export { changeOwnPassword, changeOwnPasswordSchema, revokeOwnSessions, revokeOwnSessionsSchema } from './account-security.ts';
export { hashPassword, verifyPassword, authenticate, loadPrincipal, bootstrapTenant, type Principal, type BootstrapInput } from './auth.ts';
export { tableResult, tableColumn, column, COLUMN_KINDS, MAX_REPORT_ROWS, type TableResult, type TableColumn, type ColumnKind } from './table-result.ts';
export { defineWriteCapability, withWriteCapability, hasWriteCapability, type WriteCapability } from './write-capability.ts';
export { withLock, withSavepoint } from './transactions.ts';
export { registerStoreAccess } from './store-access.ts';
export { companyBelongsToTenant, resolveCompanyAccess, selectableCompanies, assertCompanyUser, companyMemberIdentities } from './company-access.ts';
export { createManagedUser, updateManagedUser } from './access-users.ts';
export { putCompanyMembership, removeCompanyMembership } from './access-memberships.ts';
export { accessDirectory, accessAudit } from './access-directory.ts';
export { createUserSchema, updateUserSchema, membershipSchema, removeMembershipSchema } from './access-admin-common.ts';

export * from './identity/index.ts';

export { authorizedCompanies, withAuthorizedCompany, type AuthorizedCompany } from './authorized-companies.ts';

export * from './relay-auth.ts';
export { contentHash, contentHashBytes } from './content-hash.ts';
