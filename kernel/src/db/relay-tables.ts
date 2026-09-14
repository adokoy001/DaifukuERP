// Machine authentication infrastructure. No generic CRUD or human login.
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { registry } from '../registry.ts';
import { sql } from 'drizzle-orm';
import { companies, users } from './system-tables.ts';
import { TENANT_POLICY_SQL } from './table.ts';
const policy = (name: string) =>
  pgPolicy(name + '_tenant_isolation', {
    for: 'all',
    to: 'public',
    using: TENANT_POLICY_SQL,
    withCheck: TENANT_POLICY_SQL,
  });
export const relayCredentials = pgTable(
  'relay_credentials',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    gatewayId: uuid('gateway_id').notNull(),
    siteId: uuid('site_id').notNull(),
    secretHash: text('secret_hash').notNull(),
    credentialVersion: integer('credential_version').notNull(),
    active: boolean('active').notNull().default(true),
    rotationId: uuid('rotation_id'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'relay_credential_company_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [companies.tenantId, companies.id],
    }),
    uniqueIndex('relay_credential_hash_uq').on(t.secretHash),
    uniqueIndex('relay_credential_generation_uq').on(t.tenantId, t.companyId, t.gatewayId, t.credentialVersion),
    uniqueIndex('relay_credential_active_uq')
      .on(t.tenantId, t.companyId, t.gatewayId)
      .where(sql`${t.active} = true`),
    index('relay_gateway_idx').on(t.tenantId, t.companyId, t.gatewayId),
    policy('relay_credentials'),
  ],
).enableRLS();
export const relayPairings = pgTable(
  'relay_pairings',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    gatewayId: uuid('gateway_id').notNull(),
    siteId: uuid('site_id').notNull(),
    issuedBy: uuid('issued_by').notNull(),
    sessionVersion: integer('session_version').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'relay_pairing_company_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [companies.tenantId, companies.id],
    }),
    foreignKey({
      name: 'relay_pairing_issuer_fk',
      columns: [t.tenantId, t.issuedBy],
      foreignColumns: [users.tenantId, users.id],
    }),
    uniqueIndex('relay_pairing_hash_uq').on(t.tokenHash),
    index('relay_pairing_gateway_idx').on(t.tenantId, t.companyId, t.gatewayId),
    policy('relay_pairings'),
  ],
).enableRLS();
registry.registerSystemTable('relay_credentials', relayCredentials);
registry.registerSystemTable('relay_pairings', relayPairings);
