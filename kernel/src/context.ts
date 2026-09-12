// Request context (ADR-0004, ADR-0007). Every repository/action call carries one.
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Locale } from './i18n.ts';
import type { StoragePort } from './storage.ts';

/** The Drizzle transaction handle. All kernel operations run inside a transaction. */
export type Db = Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0];

export interface Actor {
  type: 'user' | 'agent' | 'system' | 'relay';
  /** user id, agent id, or 'system' */
  id: string;
  /** For agents: the user they act for. Recorded in the audit log. */
  onBehalfOf?: string;
}

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export interface RelayBinding { credentialId: string; credentialVersion: number; gatewayId: string; siteId: string }

export interface Context {
  readonly relay?: RelayBinding;
  /** Session generation carried through authenticated, cross-company work. */
  readonly sessionVersion?: number;
  readonly mfaVerified?: boolean;
  readonly accessScope?: 'all' | 'stores' | 'sites';
  readonly storeIds?: readonly string[];
  readonly siteIds?: readonly string[];
  readonly tenantAdmin?: boolean;
  /** Loaded from the selected company's settings; registration alone never activates a pack. */
  readonly appliedPacks?: readonly string[];
  readonly tenantId: string;
  /** Company the request operates in. null only for tenant-level administration. */
  readonly companyId: string | null;
  readonly actor: Actor;
  readonly roles: readonly string[];
  readonly requestId: string;
  readonly locale: Locale;
  readonly db: Db;
  readonly log: Logger;
  /** Binary evidence storage (ADR-0013 port). Throws with a hint if the app did not configure it. */
  readonly storage: StoragePort;
  now(): Date;
  /** Enqueue an event in the transactional outbox (delivered after commit). */
  emit(topic: string, payload: unknown): Promise<void>;
}

export interface ContextParams {
  relay?: RelayBinding;
  /** Authenticated session generation for long-lived adapters such as MCP. */
  sessionVersion?: number;
  mfaVerified?: boolean;
  accessScope?: 'all' | 'stores' | 'sites';
  storeIds?: readonly string[];
  siteIds?: readonly string[];
  tenantAdmin?: boolean;
  /** Internal context derivation only; withContext replaces this with the company's stored activation. */
  appliedPacks?: readonly string[];
  tenantId: string;
  companyId: string | null;
  actor: Actor;
  roles: readonly string[];
  requestId?: string;
  locale?: Locale;
  log?: Logger;
  now?: () => Date;
}

export const ADMIN_ROLE = 'admin';
export const SYSTEM_ROLES: readonly string[] = [ADMIN_ROLE];

export const consoleLogger: Logger = {
  info: (msg, data) => console.warn(JSON.stringify({ level: 'info', msg, ...data })),
  warn: (msg, data) => console.warn(JSON.stringify({ level: 'warn', msg, ...data })),
  error: (msg, data) => console.error(JSON.stringify({ level: 'error', msg, ...data })),
};

export function isAdmin(ctx: Pick<Context, 'roles'>): boolean {
  return ctx.roles.includes(ADMIN_ROLE);
}
