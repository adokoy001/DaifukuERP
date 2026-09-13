// Kernel-owned tables: tenants, companies, users, sequences, audit_log, outbox, ext_field_definitions.
import { sql } from 'drizzle-orm';
import {
  bigint,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { registry } from '../registry.ts';
import { TENANT_POLICY_SQL } from './table.ts';

const tenantPolicy = (name: string) =>
  pgPolicy(`${name}_tenant_isolation`, {
    as: 'permissive',
    for: 'all',
    to: 'public',
    using: TENANT_POLICY_SQL,
    withCheck: TENANT_POLICY_SQL,
  });

/** Tenants are not RLS-scoped: only the owner role (system context) reads this table. */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    country: text('country').notNull().default('JP'),
    currency: text('currency').notNull().default('JPY'),
    /** Company settings (tax rounding unit, fiscal year start, ...) — validated by the modules that own each key. */
    settings: jsonb('settings')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('companies_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('companies_code_uq').on(t.tenantId, t.code),
    tenantPolicy('companies'),
  ],
).enableRLS();

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    /** Legacy migration input only. Runtime authorization uses company memberships. */
    roles: jsonb('roles')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<string[]>(),
    defaultCompanyId: uuid('default_company_id'),
    active: integer('active').notNull().default(1),
    tenantAdmin: integer('tenant_admin').notNull().default(0),
    version: integer('version').notNull().default(1),
    sessionVersion: integer('session_version').notNull().default(1),
    mfaEnabled: integer('mfa_enabled').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('users_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('users_email_uq').on(t.tenantId, t.email),
    foreignKey({
      name: 'users_default_company_scope_fk',
      columns: [t.tenantId, t.defaultCompanyId],
      foreignColumns: [companies.tenantId, companies.id],
    }),
    tenantPolicy('users'),
  ],
).enableRLS();

export const companyMemberships = pgTable(
  'user_company_memberships',
  {
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    companyId: uuid('company_id').notNull(),
    roles: jsonb('roles')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<string[]>(),
    accessScope: text('access_scope').notNull().default('all').$type<'all' | 'stores' | 'sites'>(),
    storeIds: jsonb('store_ids')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<string[]>(),
    siteIds: jsonb('site_ids')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<string[]>(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId, t.companyId] }),
    foreignKey({
      name: 'membership_user_scope_fk',
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }),
    foreignKey({
      name: 'membership_company_scope_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [companies.tenantId, companies.id],
    }),
    tenantPolicy('user_company_memberships'),
  ],
).enableRLS();

/** No-gap numbering (ADR-0006). Row lock on UPDATE serialises concurrent submits per key. */
export const sequences = pgTable(
  'sequences',
  {
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    key: text('key').notNull(),
    period: text('period').notNull().default(''),
    nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.companyId, t.key, t.period] }), tenantPolicy('sequences')],
).enableRLS();

/** Append-only audit trail (ADR-0007, 電帳法 訂正削除履歴). Never updated or deleted by the app role. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id'),
    entity: text('entity').notNull(),
    recordId: uuid('record_id').notNull(),
    op: text('op').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    onBehalfOf: text('on_behalf_of'),
    action: text('action'),
    requestId: text('request_id'),
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    before: jsonb('before'),
    after: jsonb('after'),
  },
  (t) => [
    index('audit_log_record_idx').on(t.tenantId, t.entity, t.recordId),
    index('audit_log_at_idx').on(t.tenantId, t.at),
    tenantPolicy('audit_log'),
  ],
).enableRLS();

/** Transactional outbox (ADR-0001). Written in the same transaction as the change; delivered by the worker. */
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id'),
    topic: text('topic').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [index('outbox_pending_idx').on(t.tenantId, t.publishedAt, t.createdAt), tenantPolicy('outbox')],
).enableRLS();

/** Definitions of JSONB ext fields (ADR-0003): which keys an entity's `ext` may hold, their type and owner pack. */
export const extFieldDefinitions = pgTable(
  'ext_field_definitions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    entity: text('entity').notNull(),
    key: text('key').notNull(),
    kind: text('kind').notNull(),
    label: jsonb('label').notNull(),
    owner: text('owner').notNull(),
    required: integer('required').notNull().default(0),
    options: jsonb('options'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ext_field_definitions_uq').on(t.tenantId, t.entity, t.key),
    tenantPolicy('ext_field_definitions'),
  ],
).enableRLS();

registry.registerSystemTable('tenants', tenants);
registry.registerSystemTable('companies', companies);
registry.registerSystemTable('users', users);
registry.registerSystemTable('user_company_memberships', companyMemberships);
registry.registerSystemTable('sequences', sequences);
registry.registerSystemTable('audit_log', auditLog);
registry.registerSystemTable('outbox', outbox);
registry.registerSystemTable('ext_field_definitions', extFieldDefinitions);

/** Tables that must not be RLS-forced (no tenant column). */
export const NON_TENANT_TABLES: readonly string[] = ['tenants', 'identity_rate_limits'];
