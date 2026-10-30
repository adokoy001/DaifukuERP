// Kernel tables of business event delivery (docs/specs/event-delivery.md, ADR-0037): one row per event and destination,
// the write-only webhook signing secrets and the users who asked for inbox mail. Not business entities: never exposed as
// generic CRUD, REST or MCP tools. Every table is tenant-scoped by RLS like the rest of the kernel tables.
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { registry } from '../registry.ts';
import { companies, users } from './system-tables.ts';
import { TENANT_POLICY_SQL } from './table.ts';

const policy = (name: string) =>
  pgPolicy(`${name}_tenant_isolation`, {
    for: 'all',
    to: 'public',
    using: TENANT_POLICY_SQL,
    withCheck: TENANT_POLICY_SQL,
  });

export type DeliveryChannel = 'webhook' | 'email';
export type DeliveryStatus = 'pending' | 'sending' | 'delivered' | 'dead' | 'cancelled';

/**
 * One event to one destination (a webhook endpoint or a user's mailbox). `id` is the delivery id: it stays the same over
 * retries and manual resends, so receivers can drop duplicates. A claimed row is `sending` with a lease; its
 * `next_attempt_at` equals `lease_until`, so an expired lease is due under the same condition as a pending row.
 */
export const eventDeliveries = pgTable(
  'event_deliveries',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    eventId: uuid('event_id').notNull(),
    topic: text('topic').notNull(),
    channel: text('channel').notNull().$type<DeliveryChannel>(),
    /** Endpoint id (webhook) or user id (email). Never an address. */
    target: text('target').notNull(),
    /** SHA-256 of the endpoint URL the row was routed to (webhook only). */
    targetUrlHash: text('target_url_hash'),
    payload: jsonb('payload').notNull(),
    eventCreatedAt: timestamp('event_created_at', { withTimezone: true, mode: 'date' }).notNull(),
    status: text('status').notNull().default('pending').$type<DeliveryStatus>(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }).notNull(),
    leaseId: uuid('lease_id'),
    leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
    /** Classification code of the last failure or cancellation (never a raw message). */
    lastError: text('last_error'),
    lastStatus: integer('last_status'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }),
    deadAt: timestamp('dead_at', { withTimezone: true, mode: 'date' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('event_deliveries_target_uq').on(t.tenantId, t.eventId, t.channel, t.target),
    index('event_deliveries_due_idx')
      .on(t.tenantId, t.nextAttemptAt)
      .where(sql`${t.status} in ('pending', 'sending')`),
    index('event_deliveries_list_idx').on(t.tenantId, t.companyId, t.status, t.createdAt.desc()),
    foreignKey({
      name: 'event_deliveries_company_scope_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [companies.tenantId, companies.id],
    }),
    policy('event_deliveries'),
  ],
).enableRLS();

/**
 * Webhook signing secrets: AES-256-GCM ciphertext only (identity encryption key, purpose-bound AAD). Shown once when
 * issued; no API, log, audit row or setting ever carries the plain secret again.
 */
export const webhookSecrets = pgTable(
  'webhook_secrets',
  {
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    endpointId: text('endpoint_id').notNull(),
    secretCipher: text('secret_cipher').notNull(),
    /** SHA-256 of the endpoint URL when the secret was issued: the secret is valid only for that URL. */
    urlHash: text('url_hash').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** First issue for this URL: events created before it are not sent to the endpoint. */
    activatedAt: timestamp('activated_at', { withTimezone: true, mode: 'date' }).notNull(),
    issuedBy: uuid('issued_by').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.companyId, t.endpointId] }),
    foreignKey({
      name: 'webhook_secrets_company_scope_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [companies.tenantId, companies.id],
    }),
    foreignKey({
      name: 'webhook_secrets_issuer_scope_fk',
      columns: [t.tenantId, t.issuedBy],
      foreignColumns: [users.tenantId, users.id],
    }),
    policy('webhook_secrets'),
  ],
).enableRLS();

/** A row means the user asked for inbox mail in that company. `last_total` null = no baseline observed yet. */
export const inboxWatches = pgTable(
  'inbox_watches',
  {
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    userId: uuid('user_id').notNull(),
    lastTotal: integer('last_total'),
    observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.companyId, t.userId] }),
    index('inbox_watches_due_idx').on(t.nextCheckAt, t.tenantId),
    foreignKey({
      name: 'inbox_watches_company_scope_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [companies.tenantId, companies.id],
    }),
    foreignKey({
      name: 'inbox_watches_user_scope_fk',
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }),
    policy('inbox_watches'),
  ],
).enableRLS();

registry.registerSystemTable('event_deliveries', eventDeliveries);
registry.registerSystemTable('webhook_secrets', webhookSecrets);
registry.registerSystemTable('inbox_watches', inboxWatches);
