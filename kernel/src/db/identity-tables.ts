// Kernel authentication tables, not business entities (ADR-0022). Never exposed as generic CRUD.
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { registry } from '../registry.ts';
import { users } from './system-tables.ts';
import { TENANT_POLICY_SQL } from './table.ts';
const policy = (name: string) =>
  pgPolicy(`${name}_tenant_isolation`, {
    for: 'all',
    to: 'public',
    using: TENANT_POLICY_SQL,
    withCheck: TENANT_POLICY_SQL,
  });
export const identityChallenges = pgTable(
  'identity_challenges',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id'),
    purpose: text('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('identity_challenge_hash_uq').on(t.tokenHash),
    index('identity_challenge_expiry_idx').on(t.expiresAt),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
    policy('identity_challenges'),
  ],
).enableRLS();
export const identityFactors = pgTable(
  'identity_factors',
  {
    userId: uuid('user_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    secretCipher: text('secret_cipher').notNull(),
    recoveryHashes: jsonb('recovery_hashes').notNull().$type<string[]>(),
    lastStep: integer('last_step').notNull().default(-1),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
    policy('identity_factors'),
  ],
).enableRLS();
export const identityLinks = pgTable(
  'identity_links',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    providerId: text('provider_id').notNull(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('identity_link_subject_uq').on(t.tenantId, t.issuer, t.subject),
    uniqueIndex('identity_link_user_provider_uq').on(t.tenantId, t.userId, t.providerId),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
    policy('identity_links'),
  ],
).enableRLS();
export const identityMail = pgTable(
  'identity_mail_outbox',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    payloadCipher: text('payload_cipher').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    leaseId: uuid('lease_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('identity_mail_pending_idx').on(t.status, t.nextAttemptAt), policy('identity_mail_outbox')],
).enableRLS();
// Public pre-authentication limits are keyed hashes, with no email/IP stored. Owner-only by design.
export const identityLimits = pgTable('identity_rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(1),
});
for (const [name, table] of Object.entries({
  identity_challenges: identityChallenges,
  identity_factors: identityFactors,
  identity_links: identityLinks,
  identity_mail_outbox: identityMail,
  identity_rate_limits: identityLimits,
}))
  registry.registerSystemTable(name, table);
