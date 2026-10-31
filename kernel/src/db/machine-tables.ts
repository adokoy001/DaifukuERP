// Machine credentials (API keys; docs/specs/machine-credentials.md, ADR-0023 addendum). Authentication
// infrastructure: no generic CRUD, no human login. Only the SHA-256 hash of the secret is stored.
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { registry } from '../registry.ts';
import { companies, users } from './system-tables.ts';
import { TENANT_POLICY_SQL } from './table.ts';

export const machineCredentials = pgTable(
  'machine_credentials',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    name: text('name').notNull(),
    purpose: text('purpose').notNull(),
    roles: jsonb('roles').$type<string[]>().notNull(),
    secretHash: text('secret_hash').notNull(),
    issuedBy: uuid('issued_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by'),
    revokeReason: text('revoke_reason'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastDeniedAt: timestamp('last_denied_at', { withTimezone: true }),
    lastDeniedReason: text('last_denied_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'machine_credential_company_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [companies.tenantId, companies.id],
    }),
    foreignKey({
      name: 'machine_credential_issuer_fk',
      columns: [t.tenantId, t.issuedBy],
      foreignColumns: [users.tenantId, users.id],
    }),
    foreignKey({
      name: 'machine_credential_revoker_fk',
      columns: [t.tenantId, t.revokedBy],
      foreignColumns: [users.tenantId, users.id],
    }),
    uniqueIndex('machine_credential_hash_uq').on(t.secretHash),
    index('machine_credential_company_idx').on(t.tenantId, t.companyId),
    index('machine_credential_issuer_idx').on(t.tenantId, t.issuedBy),
    check('machine_credential_purpose_chk', sql`${t.purpose} IN ('mcp', 'integration')`),
    pgPolicy('machine_credentials_tenant_isolation', {
      for: 'all',
      to: 'public',
      using: TENANT_POLICY_SQL,
      withCheck: TENANT_POLICY_SQL,
    }),
  ],
).enableRLS();

registry.registerSystemTable('machine_credentials', machineCredentials);
