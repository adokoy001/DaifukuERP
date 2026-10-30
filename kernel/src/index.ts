// @daifuku/kernel public API. Modules import ONLY from here.
export { Decimal, isDecimal, ROUNDING_MODES, type DecimalInput, type RoundingMode } from './decimal.ts';
export {
  DaifukuError,
  ValidationError,
  PermissionDenied,
  NotFound,
  Conflict,
  StateError,
  DependencyError,
  toErrorBody,
  safeErrorDiagnostics,
  type ErrorBody,
  type ErrorCode,
} from './errors.ts';
export { label, t, type Label, type Locale } from './i18n.ts';
export { newId, isUuid, isLocalDate, todayLocal, type LocalDate } from './ids.ts';
export { toHalfwidthKana, normalizeText } from './normalize.ts';

export {
  f,
  type FieldDef,
  type AnyField,
  type FieldMap,
  type RowOf,
  type InsertOf,
  type UpdateOf,
  type ValueOf,
  type InputValueOf,
} from './dsl/fields.ts';
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
  type FormGroup,
  type EntityConfig,
  type StoreAccessPolicy,
  type DocumentConfig,
  type Transition,
  type SystemFields,
  type DocumentFields,
  type Docstatus,
} from './dsl/types.ts';
export {
  defineEntity,
  defineDocument,
  type EntityDef,
  type Infer,
  type InsertInput,
  type UpdateInput,
} from './dsl/entity.ts';
export {
  defineAction,
  toolNameOf,
  PRINT_ACTION_RE,
  type ActionDef,
  type ActionConfig,
  type ActionPermission,
  type ActionPrintBinding,
  type ActionPrintField,
} from './dsl/action.ts';
export { defineModule, type ModuleDef, type ModuleConfig, type MenuItem } from './dsl/module.ts';
export { EXT_PREFIX, type ExtFieldDef, type RegisterExtOptions } from './dsl/ext.ts';
export {
  definePack,
  packSource,
  DEFAULT_PACK_VERSION,
  type PackConfig,
  type PackDef,
  type LabelOverride,
} from './dsl/pack.ts';

export {
  registry,
  HOOK_PHASES,
  type HookPhase,
  type HookFn,
  type HookArgs,
  type GuardFn,
  type EventHandler,
  type SettingDef,
  type RegistryWarning,
  type HealthCheckDef,
  type HealthOutcome,
  type HealthStatus,
} from './registry.ts';
export {
  type Context,
  type ContextParams,
  type Actor,
  type Logger,
  type Db,
  ADMIN_ROLE,
  isAdmin,
  consoleLogger,
} from './context.ts';
export { connect, withContext, makeContext, systemParams, type Database } from './db/client.ts';
export {
  tenants,
  companies,
  users,
  companyMemberships,
  sequences,
  auditLog,
  outbox,
  extFieldDefinitions,
} from './db/system-tables.ts';
export { runMigrations, enforcePolicies, dropAll } from './db/migrate.ts';
export { APP_ROLE, TENANT_SETTING, toSnake } from './db/table.ts';

export { repo, Repository, type ListResult } from './repository/repository.ts';
export { listQuerySchema, type ListQuery } from './repository/query.ts';
export { aggregate, type AggregateQuery, type AggregateRow, type Metric } from './repository/aggregate.ts';
export { getLines, saveLines, lineSpecs, isSavingLines, type LinesInput, type LinesResult } from './lines.ts';
export {
  getCompany,
  findCompany,
  getSetting,
  setSetting,
  deleteSetting,
  settingHistory,
  currencyScale,
  DEFAULT_CURRENCY_SCALE,
  type CompanyInfo,
  type SettingChange,
} from './settings.ts';
export {
  SETTING_CATEGORIES,
  SETTING_WIDGETS,
  checkSettingDef,
  defaultSettingCategory,
  settingCategory,
  settingShape,
  type SettingCategory,
  type SettingFieldDef,
  type SettingManagedBy,
  type SettingPresentation,
  type SettingShape,
  type SettingValueInfo,
  type SettingWidget,
} from './setting-presentation.ts';
export { configureStorage, storage, LocalStorage, type StoragePort, type StoredObject } from './storage.ts';
export { snapshot } from './repository/rows.ts';
export { submitDocument, cancelDocument, amendDocument, transitionDocument, findDependents } from './document.ts';
export { nextNumber } from './numbering.ts';
export { writeAudit, auditTrail, auditSnapshotFilter, type AuditEntry } from './audit.ts';
export {
  AUDIT_OP_LABELS,
  AUDIT_SEARCH_DEFAULT_LIMIT,
  AUDIT_SEARCH_MAX_DAYS,
  AUDIT_SEARCH_MAX_LIMIT,
  AUDIT_SEARCH_MIN_DATE,
  AUDIT_SUBJECTS,
  auditPeriod,
  auditPeriodDays,
  auditSearchOptions,
  auditSearchQuery,
  decodeAuditCursor,
  encodeAuditCursor,
  searchAudit,
  type AuditCursor,
  type AuditScope,
  type AuditSearchItem,
  type AuditSearchOptions,
  type AuditSearchQuery,
  type AuditSearchResult,
  type AuditSubjectDef,
  type AuditSubjectOption,
  type AuditUserKind,
  type AuditUserOption,
} from './audit-search.ts';
export {
  derivePermissionMatrix,
  describeRowRule,
  isSelfRule,
  permissionMatrix,
  type MatrixAction,
  type MatrixActionPermission,
  type MatrixEntity,
  type MatrixFieldGroup,
  type MatrixInput,
  type MatrixPack,
  type MatrixPolicy,
  type MatrixRole,
  type MatrixRowRule,
  type MatrixScopeNote,
  type MatrixTransition,
  type PermissionMatrix,
} from './permission-matrix.ts';
export {
  ACCESS_INSIGHT_ROLES,
  assertAccessInsight,
  HEALTH_ROLES,
  hasAnyRole,
  KERNEL_CAPABILITIES,
  SETTINGS_ROLES,
  type KernelCapability,
} from './kernel-capabilities.ts';
export { deliverPending, type DeliveryResult } from './events.ts';
export {
  can,
  assertOp,
  assertReadableFields,
  allowedOps,
  rowFilter,
  compileDomain,
  maskedFields,
  grantedRoles,
} from './permissions.ts';
export { registerCrudActions } from './actions/crud.ts';
export {
  assertImportable,
  importRecords,
  importTemplateCsv,
  importInputSchema,
  importResultSchema,
  isImportable,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  type ImportInput,
  type ImportMessage,
  type ImportResult,
  type ImportRowResult,
} from './import.ts';
// Cell conversions of the import port, reused by module-owned imports (docs/specs/opening-balances.md D-12, ADR-0030).
export { decimalCell, dateCell, isContextToken } from './import-values.ts';
export { EXPORT_ROWS_LIMIT } from './actions/export-rows.ts';
export { registerPackActions } from './actions/pack.ts';
export {
  relatedLinkSpecs,
  relatedRecords,
  RELATED_LIMIT,
  type LinkSpec as RelatedLinkSpec,
  type RelatedGroup,
  type RelatedItem,
  type RelatedRelation,
  type RelatedResult,
} from './related.ts';
export {
  applyPack,
  readAppliedPacks,
  appliedPacksOf,
  ensurePackSettings,
  PACKS_APPLIED_KEY,
  appliedPacksSchema,
  type ApplyPackOptions,
  type ApplyPackResult,
  type AppliedPack,
  type AppliedPacks,
} from './pack.ts';
export { runAction, checkActionPermission, checkActionExport, canExportAction, canRunAction } from './actions/run.ts';
export {
  entityMeta,
  appMeta,
  fieldMeta,
  extFieldMetas,
  printBindingMeta,
  type PrintBindingMeta,
  type EntityMeta,
  type FieldMeta,
  type FormGroupMeta,
  type AppMeta,
  type MetaOptions,
} from './meta.ts';
export {
  changeOwnPassword,
  changeOwnPasswordSchema,
  revokeOwnSessions,
  revokeOwnSessionsSchema,
} from './account-security.ts';
export {
  hashPassword,
  verifyPassword,
  authenticate,
  loadPrincipal,
  bootstrapTenant,
  type Principal,
  type BootstrapInput,
} from './auth.ts';
export {
  tableResult,
  tableColumn,
  column,
  COLUMN_KINDS,
  MAX_REPORT_ROWS,
  type TableResult,
  type TableColumn,
  type ColumnKind,
} from './table-result.ts';
export {
  todoInput,
  todoItem,
  todoItems,
  todoResult,
  TODO_HREF,
  TODO_SEVERITIES,
  type TodoCandidate,
  type TodoItem,
  type TodoResult,
  type TodoSeverity,
} from './todo-result.ts';
export {
  defineWriteCapability,
  withWriteCapability,
  hasWriteCapability,
  type WriteCapability,
} from './write-capability.ts';
export { withLock, withSavepoint } from './transactions.ts';
export { registerStoreAccess } from './store-access.ts';
export {
  companyBelongsToTenant,
  resolveCompanyAccess,
  selectableCompanies,
  assertCompanyUser,
  companyMemberIdentities,
  activeCompanyMemberCount,
} from './company-access.ts';
export { createManagedUser, updateManagedUser } from './access-users.ts';
export { putCompanyMembership, removeCompanyMembership } from './access-memberships.ts';
export { accessDirectory, accessAudit } from './access-directory.ts';
export { createUserSchema, updateUserSchema, membershipSchema, removeMembershipSchema } from './access-admin-common.ts';
export {
  COMPANY_CODE,
  createCompany,
  createCompanySchema,
  listCompanies,
  SUPPORTED_COMPANY_CURRENCIES,
  updateCompany,
  updateCompanySchema,
  type AdminCompany,
  type CreateCompanyOptions,
  type CreatedCompany,
} from './company-admin.ts';
export {
  assertHealthAccess,
  COMPANY_PROFILE_CHECK,
  HEALTH_STATUSES,
  healthChecks,
  isHealthHref,
  KERNEL_HEALTH_CHECKS,
  OUTBOX_CHECK,
  runHealthChecks,
  type HealthItem,
  type HealthReport,
} from './health.ts';
export {
  COMPANY_PROFILE_KEY,
  COMPANY_PROFILE_SETTING,
  INVOICE_REGISTRATION_NO,
  companyProfileOf,
  companyProfileSchema,
  ensureCompanyProfileSetting,
  getCompanyProfile,
  type CompanyProfile,
} from './company-profile.ts';
export { isAppHref } from './app-href.ts';
export {
  ensureSetupProgressSetting,
  SETUP_PROGRESS_KEY,
  SETUP_PROGRESS_SETTING,
  SETUP_STEP_IDS,
  setupProgressOf,
  setupProgressSchema,
  setupStepRecordSchema,
  type SetupProgress,
  type SetupStepId,
  type SetupStepRecord,
} from './setup-progress.ts';
export {
  eventDeliveries,
  webhookSecrets,
  inboxWatches,
  type DeliveryChannel,
  type DeliveryStatus,
} from './db/event-tables.ts';
export {
  DEFAULT_INTEGRATION_WEBHOOKS,
  ensureIntegrationSettings,
  INBOX_TOPIC_PREFIX,
  integrationWebhooksOf,
  integrationWebhooksSchema,
  INTEGRATION_WEBHOOKS_KEY,
  INTEGRATION_WEBHOOKS_SETTING,
  isLoopbackWebhookUrl,
  MAX_WEBHOOK_ENDPOINTS,
  topicMatches,
  webhookEndpointSchema,
  webhookUrlHash,
  webhookUrlProblem,
  WEBHOOK_TOPIC,
  type IntegrationWebhooks,
  type WebhookEndpoint,
} from './integration-settings.ts';
export {
  MAX_WEBHOOK_BODY_BYTES,
  signWebhook,
  verifyWebhookSignature,
  webhookBody,
  webhookHeaders,
  WEBHOOK_USER_AGENT,
  type WebhookEnvelope,
} from './webhook-signing.ts';
export {
  assertEventAdmin,
  deliverEventDeliveries,
  DELIVERY_CANCEL_CODES,
  DELIVERY_FAILURE_CODES,
  DELIVERY_LEASE_MS,
  DELIVERY_LIST_STATUSES,
  DELIVERY_RETENTION_DAYS,
  deliveryListQuerySchema,
  deliveryRetentionCutoff,
  listEventDeliveries,
  MAX_DELIVERY_ATTEMPTS,
  purgeEventDeliveries,
  retryDelaySeconds,
  retryEventDelivery,
  routeEvent,
  safeDiagnostic,
  safeDiagnosticFields,
  WEBHOOK_FAILURE_CODES,
  type DeliveryList,
  type DeliveryListItem,
  type DeliveryListQuery,
  type DeliveryListStatus,
  type DeliverySendDeps,
  type DeliverySendResult,
  type WebhookFailureCode,
  type WebhookOutcome,
  type WebhookRequest,
  type WebhookTransport,
} from './event-delivery.ts';
export {
  issueWebhookSecret,
  webhookEndpoints,
  type IssuedWebhookSecret,
  type WebhookEndpointsView,
  type WebhookEndpointView,
  type WebhookSecretState,
} from './webhook-secrets.ts';
export {
  claimInboxWatches,
  getInboxNotification,
  inboxEmailMessage,
  inboxProviderNames,
  INBOX_COUNT_CHANGED,
  recordInboxObservation,
  removeInboxWatch,
  setInboxNotification,
  summarizeInbox,
  type ClaimedWatch,
  type InboxNotification,
  type InboxSummary,
  type InboxSummaryItem,
} from './inbox-watch.ts';

export * from './identity/index.ts';

export { authorizedCompanies, withAuthorizedCompany, type AuthorizedCompany } from './authorized-companies.ts';

export * from './relay-auth.ts';
export * from './machine-credentials.ts';
export { requireHumanUserId } from './access-admin-common.ts';
export { contentHash, contentHashBytes } from './content-hash.ts';
