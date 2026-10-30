// Business event delivery, second stage (docs/specs/event-delivery.md, ADR-0037). deliverPending (events.ts) routes a
// delivered outbox event to delivery rows inside its savepoint (routeEvent); the worker then claims one row at a time in
// a short transaction (FOR UPDATE SKIP LOCKED, lease id), sends with no transaction open, and writes the result only to
// the row whose lease it still holds. Delivery is at least once: the delivery id is stable so receivers drop duplicates.
// The system context here touches only kernel delivery tables, company settings and user mail addresses (ADR-0037).
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from './audit.ts';
import { consoleLogger, isAdmin, type Context, type Logger } from './context.ts';
import { withContext, systemParams, type Database } from './db/client.ts';
import {
  eventDeliveries,
  inboxWatches,
  webhookSecrets,
  type DeliveryChannel,
  type DeliveryStatus,
} from './db/event-tables.ts';
import { companies, companyMemberships, outbox, users } from './db/system-tables.ts';
import {
  DaifukuError,
  NotFound,
  PermissionDenied,
  safeErrorDiagnostics,
  StateError,
  ValidationError,
} from './errors.ts';
import { unseal } from './identity/crypto.ts';
import type { IdentityMailTransport } from './identity/mail.ts';
import { isUuid, newId } from './ids.ts';
import { inboxEmailMessage, INBOX_COUNT_CHANGED } from './inbox-watch.ts';
import {
  INBOX_TOPIC_PREFIX,
  integrationWebhooksOf,
  INTEGRATION_WEBHOOKS_KEY,
  topicMatches,
  webhookUrlHash,
} from './integration-settings.ts';
import { getCompany } from './settings.ts';
import { MAX_WEBHOOK_BODY_BYTES, webhookBody, webhookHeaders } from './webhook-signing.ts';

/** Attempts before a row becomes `dead` (outbox rows and delivery rows alike). */
export const MAX_DELIVERY_ATTEMPTS = 8;
export const DELIVERY_LEASE_MS = 60_000;
export const DELIVERY_RETENTION_DAYS = 30;
const PURGE_BATCH = 500;

/** Seconds before the next attempt after the `attempts`-th failure: 60, 120, 240, ... capped at 3600. */
export function retryDelaySeconds(attempts: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempts - 1), 3600);
}

export const WEBHOOK_FAILURE_CODES = [
  'timeout',
  'network',
  'tls',
  'redirect',
  'http_status',
  'blocked_destination',
] as const;
export type WebhookFailureCode = (typeof WEBHOOK_FAILURE_CODES)[number];
export const DELIVERY_FAILURE_CODES = [
  ...WEBHOOK_FAILURE_CODES,
  'secret_unreadable',
  'payload_too_large',
  'lease_expired',
  'mail_failed',
  'subscriber_failed',
] as const;
export const DELIVERY_CANCEL_CODES = [
  'endpoint_removed',
  'endpoint_disabled',
  'endpoint_changed',
  'topic_unsubscribed',
  'recipient_inactive',
  'notification_off',
] as const;
export type DeliveryCancelCode = (typeof DELIVERY_CANCEL_CODES)[number];
/** Failures that no retry can fix: the row is `dead` at once. */
const PERMANENT_FAILURES: ReadonlySet<string> = new Set([
  'blocked_destination',
  'secret_unreadable',
  'payload_too_large',
]);

/** One HTTP attempt handed to the API's adapter (the adapter resolves, checks and connects; AC-9, AC-13). */
export interface WebhookRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
  /** Aborted when the process shuts down; the row is then left `sending` and reclaimed after its lease. */
  signal?: AbortSignal;
}
export type WebhookOutcome = { ok: true; status: number } | { ok: false; code: WebhookFailureCode; status?: number };
/** Port implemented by apps/api (node:http / node:https). */
export interface WebhookTransport {
  send(request: WebhookRequest): Promise<WebhookOutcome>;
}

/**
 * Safe diagnostic text for outbox.last_error and logs (docs/conventions/errors.md): a DaifukuError's code and message
 * (safe by convention), otherwise INTERNAL and the SQLSTATE only. Never a raw exception message.
 */
export function safeDiagnostic(error: unknown): string {
  if (error instanceof DaifukuError) return `${error.code}: ${error.message}`.slice(0, 500);
  const diag = safeErrorDiagnostics(error);
  return diag.sqlState ? `INTERNAL (SQLSTATE ${diag.sqlState})` : 'INTERNAL';
}

/** The same diagnostic as structured log fields. */
export function safeDiagnosticFields(error: unknown): Record<string, unknown> {
  return error instanceof DaifukuError ? { code: error.code } : { code: 'INTERNAL', ...safeErrorDiagnostics(error) };
}

// ---------------------------------------------------------------------------------------------------------------
// Routing (inside deliverPending's savepoint)

export interface RoutedEvent {
  id: string;
  topic: string;
  payload: unknown;
  companyId: string | null;
  createdAt: Date;
}

interface InboxPayload {
  userId: string;
  total: number;
  previousTotal: number;
}

function inboxPayload(payload: unknown): InboxPayload | null {
  const p = payload as Partial<InboxPayload> | null;
  if (!p || typeof p.userId !== 'string' || !isUuid(p.userId)) return null;
  if (!Number.isSafeInteger(p.total) || !Number.isSafeInteger(p.previousTotal)) return null;
  return { userId: p.userId, total: p.total as number, previousTotal: p.previousTotal as number };
}

/**
 * Creates the delivery rows of one event (AC-6, AC-7): a webhook row per enabled endpoint of the event's company that
 * subscribes to the topic and holds a valid secret activated no later than the event, and an email row for an
 * `inbox.count_changed` increase of a user who asked for mail. Duplicates (same event, channel and target) are ignored.
 * Returns the number of rows created.
 */
export async function routeEvent(
  ctx: Context,
  event: RoutedEvent,
  settings: Readonly<Record<string, unknown>> | undefined,
): Promise<number> {
  if (!event.companyId) return 0;
  const { value, valid } = integrationWebhooksOf(settings ?? {});
  if (!valid)
    ctx.log.warn('invalid company setting, routing the event to no endpoint', {
      key: INTEGRATION_WEBHOOKS_KEY,
      companyId: event.companyId,
    });
  const now = ctx.now();
  const base = {
    tenantId: ctx.tenantId,
    companyId: event.companyId,
    eventId: event.id,
    topic: event.topic,
    payload: (event.payload ?? {}) as Record<string, unknown>,
    eventCreatedAt: event.createdAt,
    status: 'pending' as const,
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
  };
  const rows: (typeof eventDeliveries.$inferInsert)[] = [];
  if (!event.topic.startsWith(INBOX_TOPIC_PREFIX)) {
    const candidates = value.endpoints.filter(
      (endpoint) => endpoint.enabled && endpoint.topics.some((pattern) => topicMatches(pattern, event.topic)),
    );
    if (candidates.length > 0) {
      const secrets = await ctx.db
        .select({
          endpointId: webhookSecrets.endpointId,
          urlHash: webhookSecrets.urlHash,
          activatedAt: webhookSecrets.activatedAt,
        })
        .from(webhookSecrets)
        .where(
          and(
            eq(webhookSecrets.tenantId, ctx.tenantId),
            eq(webhookSecrets.companyId, event.companyId),
            inArray(
              webhookSecrets.endpointId,
              candidates.map((endpoint) => endpoint.id),
            ),
          ),
        );
      for (const endpoint of candidates) {
        const urlHash = webhookUrlHash(endpoint.url);
        const secret = secrets.find((s) => s.endpointId === endpoint.id);
        if (!secret || secret.urlHash !== urlHash || secret.activatedAt.getTime() > event.createdAt.getTime()) continue;
        rows.push({ ...base, id: newId(), channel: 'webhook', target: endpoint.id, targetUrlHash: urlHash });
      }
    }
  }
  if (event.topic === INBOX_COUNT_CHANGED && value.inboxEmail) {
    const p = inboxPayload(event.payload);
    if (p && p.total > p.previousTotal) {
      const watch = await ctx.db
        .select({ userId: inboxWatches.userId })
        .from(inboxWatches)
        .where(
          and(
            eq(inboxWatches.tenantId, ctx.tenantId),
            eq(inboxWatches.companyId, event.companyId),
            eq(inboxWatches.userId, p.userId),
          ),
        )
        .limit(1);
      if (watch.length > 0) rows.push({ ...base, id: newId(), channel: 'email', target: p.userId });
    }
  }
  if (rows.length === 0) return 0;
  const inserted = await ctx.db
    .insert(eventDeliveries)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: eventDeliveries.id });
  return inserted.length;
}

// ---------------------------------------------------------------------------------------------------------------
// Sending (worker; system context per short transaction)

export interface DeliverySendDeps {
  /** Absent when the process has no identity encryption key: webhook rows are then left for another process. */
  webhook?: { transport: WebhookTransport; encryptionKey: string };
  /** Absent when the process has no SMTP transport: email rows are left for another process. */
  mail?: { transport: IdentityMailTransport; webUrl: string };
  now?: () => Date;
  /** Rows sent per call (per tenant per tick). Default 20. */
  limit?: number;
  /** Parallel sends. Default 4. */
  concurrency?: number;
  signal?: AbortSignal;
  log?: Logger;
}

export interface DeliverySendResult {
  sent: number;
  failed: number;
  dead: number;
  cancelled: number;
  /** Due rows of a channel this process cannot send (no key / no mail transport). */
  skipped: number;
}

type Row = typeof eventDeliveries.$inferSelect;
type Claim =
  | { kind: 'none' }
  | { kind: 'settled'; outcome: 'dead' | 'cancelled' }
  | { kind: 'webhook'; row: Row; leaseId: string; attempts: number; url: string; secretCipher: string }
  | { kind: 'email'; row: Row; leaseId: string; attempts: number; to: string; companyName: string };
type Settled = 'sent' | 'failed' | 'dead' | 'cancelled' | 'aborted';

export function webhookSecretPurpose(tenantId: string, companyId: string, endpointId: string): string {
  return `${tenantId}:${companyId}:${endpointId}:webhook-secret`;
}

function dueCondition(tenantId: string, now: Date, channels: readonly DeliveryChannel[]): SQL | undefined {
  return and(
    eq(eventDeliveries.tenantId, tenantId),
    inArray(eventDeliveries.status, ['pending', 'sending']),
    lte(eventDeliveries.nextAttemptAt, now),
    inArray(eventDeliveries.channel, [...channels]),
  );
}

async function cancelInClaim(ctx: Context, row: Row, code: DeliveryCancelCode): Promise<Claim> {
  await ctx.db
    .update(eventDeliveries)
    .set({ status: 'cancelled', cancelledAt: ctx.now(), lastError: code, leaseId: null, leaseUntil: null })
    .where(eq(eventDeliveries.id, row.id));
  return { kind: 'settled', outcome: 'cancelled' };
}

async function webhookCancelReason(ctx: Context, row: Row, settings: Record<string, unknown>) {
  const endpoint = integrationWebhooksOf(settings).value.endpoints.find((e) => e.id === row.target);
  if (!endpoint) return { reason: 'endpoint_removed' as const };
  if (!endpoint.enabled) return { reason: 'endpoint_disabled' as const };
  if (webhookUrlHash(endpoint.url) !== row.targetUrlHash) return { reason: 'endpoint_changed' as const };
  if (!endpoint.topics.some((pattern) => topicMatches(pattern, row.topic)))
    return { reason: 'topic_unsubscribed' as const };
  const [secret] = await ctx.db
    .select({ secretCipher: webhookSecrets.secretCipher, urlHash: webhookSecrets.urlHash })
    .from(webhookSecrets)
    .where(
      and(
        eq(webhookSecrets.tenantId, ctx.tenantId),
        eq(webhookSecrets.companyId, row.companyId),
        eq(webhookSecrets.endpointId, row.target),
      ),
    )
    .limit(1);
  if (!secret || secret.urlHash !== row.targetUrlHash) return { reason: 'endpoint_changed' as const };
  return { reason: null, url: endpoint.url, secretCipher: secret.secretCipher };
}

async function emailRecipient(ctx: Context, row: Row, inboxEmail: boolean) {
  const [user] = await ctx.db
    .select({ email: users.email, active: users.active, tenantAdmin: users.tenantAdmin })
    .from(users)
    .where(and(eq(users.tenantId, ctx.tenantId), isUuid(row.target) ? eq(users.id, row.target) : sql`false`))
    .limit(1);
  if (!user || !user.active) return { reason: 'recipient_inactive' as const };
  if (!user.tenantAdmin) {
    const member = await ctx.db
      .select({ userId: companyMemberships.userId })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.tenantId, ctx.tenantId),
          eq(companyMemberships.companyId, row.companyId),
          eq(companyMemberships.userId, row.target),
        ),
      )
      .limit(1);
    if (member.length === 0) return { reason: 'recipient_inactive' as const };
  }
  const watch = await ctx.db
    .select({ userId: inboxWatches.userId })
    .from(inboxWatches)
    .where(
      and(
        eq(inboxWatches.tenantId, ctx.tenantId),
        eq(inboxWatches.companyId, row.companyId),
        eq(inboxWatches.userId, row.target),
      ),
    )
    .limit(1);
  if (!inboxEmail || watch.length === 0) return { reason: 'notification_off' as const };
  return { reason: null, to: user.email };
}

/** Claims the next due row of a sendable channel (AC-10, AC-11, AC-12), resolving cancellations in the same transaction. */
async function claimNext(
  app: Database,
  tenantId: string,
  channels: readonly DeliveryChannel[],
  now: Date,
): Promise<Claim> {
  return withContext(app, systemParams(tenantId, null, { now: () => now }), async (ctx) => {
    const [row] = await ctx.db
      .select()
      .from(eventDeliveries)
      .where(dueCondition(tenantId, now, channels))
      .orderBy(asc(eventDeliveries.nextAttemptAt), asc(eventDeliveries.id))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!row) return { kind: 'none' };
    if (row.status === 'sending' && row.attempts >= MAX_DELIVERY_ATTEMPTS) {
      await ctx.db
        .update(eventDeliveries)
        .set({ status: 'dead', deadAt: now, lastError: 'lease_expired', leaseId: null, leaseUntil: null })
        .where(eq(eventDeliveries.id, row.id));
      return { kind: 'settled', outcome: 'dead' };
    }
    const [company] = await ctx.db
      .select({ name: companies.name, settings: companies.settings })
      .from(companies)
      .where(and(eq(companies.tenantId, tenantId), eq(companies.id, row.companyId)))
      .limit(1);
    const settings = (company?.settings ?? {}) as Record<string, unknown>;
    const leaseId = newId();
    const leaseUntil = new Date(now.getTime() + DELIVERY_LEASE_MS);
    const claim = async () => {
      await ctx.db
        .update(eventDeliveries)
        .set({ status: 'sending', leaseId, leaseUntil, nextAttemptAt: leaseUntil, attempts: row.attempts + 1 })
        .where(eq(eventDeliveries.id, row.id));
    };
    if (row.channel === 'webhook') {
      const resolved = await webhookCancelReason(ctx, row, settings);
      if (resolved.reason) return cancelInClaim(ctx, row, resolved.reason);
      await claim();
      return {
        kind: 'webhook',
        row,
        leaseId,
        attempts: row.attempts + 1,
        url: resolved.url as string,
        secretCipher: resolved.secretCipher as string,
      };
    }
    const resolved = await emailRecipient(ctx, row, integrationWebhooksOf(settings).value.inboxEmail);
    if (resolved.reason) return cancelInClaim(ctx, row, resolved.reason);
    await claim();
    return {
      kind: 'email',
      row,
      leaseId,
      attempts: row.attempts + 1,
      to: resolved.to as string,
      companyName: company?.name ?? '',
    };
  });
}

type Finish = { status: 'delivered'; httpStatus?: number } | { status: 'failed'; code: string; httpStatus?: number };

/** Writes one attempt's result, only while the lease is still ours (a stale lease's result is dropped). */
async function finish(
  app: Database,
  tenantId: string,
  claim: { row: Row; leaseId: string; attempts: number },
  result: Finish,
  now: Date,
  log: Logger,
): Promise<Settled> {
  let outcome: Settled;
  let patch: Partial<typeof eventDeliveries.$inferInsert>;
  if (result.status === 'delivered') {
    outcome = 'sent';
    patch = {
      status: 'delivered' as DeliveryStatus,
      deliveredAt: now,
      lastError: null,
      lastStatus: result.httpStatus ?? null,
      leaseId: null,
      leaseUntil: null,
    };
  } else if (PERMANENT_FAILURES.has(result.code) || claim.attempts >= MAX_DELIVERY_ATTEMPTS) {
    outcome = 'dead';
    patch = {
      status: 'dead',
      deadAt: now,
      lastError: result.code,
      lastStatus: result.httpStatus ?? null,
      leaseId: null,
      leaseUntil: null,
    };
  } else {
    outcome = 'failed';
    patch = {
      status: 'pending',
      nextAttemptAt: new Date(now.getTime() + retryDelaySeconds(claim.attempts) * 1000),
      lastError: result.code,
      lastStatus: result.httpStatus ?? null,
      leaseId: null,
      leaseUntil: null,
    };
  }
  const written = await withContext(app, systemParams(tenantId, null), (ctx) =>
    ctx.db
      .update(eventDeliveries)
      .set(patch)
      .where(and(eq(eventDeliveries.id, claim.row.id), eq(eventDeliveries.leaseId, claim.leaseId)))
      .returning({ id: eventDeliveries.id }),
  );
  if (written.length === 0) {
    log.warn('event delivery result dropped: the lease was taken over', { id: claim.row.id, tenantId });
    return 'aborted';
  }
  return outcome;
}

function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error('send failed'));
      },
    );
  });
}

async function sendWebhook(
  app: Database,
  tenantId: string,
  claim: Extract<Claim, { kind: 'webhook' }>,
  deps: DeliverySendDeps & { webhook: NonNullable<DeliverySendDeps['webhook']> },
  now: () => Date,
  log: Logger,
): Promise<Settled> {
  const { row } = claim;
  let secret: string;
  try {
    secret = unseal(
      claim.secretCipher,
      deps.webhook.encryptionKey,
      webhookSecretPurpose(tenantId, row.companyId, row.target),
    );
  } catch {
    return finish(app, tenantId, claim, { status: 'failed', code: 'secret_unreadable' }, now(), log);
  }
  const body = webhookBody({
    deliveryId: row.id,
    eventId: row.eventId,
    topic: row.topic,
    occurredAt: row.eventCreatedAt.toISOString(),
    companyId: row.companyId,
    data: row.payload,
  });
  if (Buffer.byteLength(body, 'utf8') > MAX_WEBHOOK_BODY_BYTES)
    return finish(app, tenantId, claim, { status: 'failed', code: 'payload_too_large' }, now(), log);
  const timestamp = Math.floor(now().getTime() / 1000);
  const headers = webhookHeaders({
    secret,
    deliveryId: row.id,
    eventId: row.eventId,
    topic: row.topic,
    timestamp,
    body,
  });
  let outcome: WebhookOutcome;
  try {
    outcome = await deps.webhook.transport.send({
      url: claim.url,
      body,
      headers,
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  } catch {
    outcome = { ok: false, code: 'network' };
  }
  if (deps.signal?.aborted) return 'aborted';
  return finish(
    app,
    tenantId,
    claim,
    outcome.ok
      ? { status: 'delivered', httpStatus: outcome.status }
      : { status: 'failed', code: outcome.code, ...(outcome.status ? { httpStatus: outcome.status } : {}) },
    now(),
    log,
  );
}

async function sendEmail(
  app: Database,
  tenantId: string,
  claim: Extract<Claim, { kind: 'email' }>,
  deps: DeliverySendDeps & { mail: NonNullable<DeliverySendDeps['mail']> },
  now: () => Date,
  log: Logger,
): Promise<Settled> {
  const message = inboxEmailMessage({
    companyName: claim.companyName,
    payload: claim.row.payload,
    webUrl: deps.mail.webUrl,
  });
  try {
    await abortable(
      deps.mail.transport.send({ to: claim.to, ...message, messageId: `<${claim.row.id}@daifuku.events>` }),
      deps.signal,
    );
  } catch {
    if (deps.signal?.aborted) return 'aborted';
    return finish(app, tenantId, claim, { status: 'failed', code: 'mail_failed' }, now(), log);
  }
  if (deps.signal?.aborted) return 'aborted';
  return finish(app, tenantId, claim, { status: 'delivered' }, now(), log);
}

/**
 * Sends up to `limit` due delivery rows of one tenant (AC-8..AC-12, AC-17), `concurrency` at a time. Channels the
 * process cannot send are never claimed and are counted as `skipped`. Each claim and each result is its own short
 * transaction on the app connection (RLS); no transaction is open while a request or mail is in flight.
 */
export async function deliverEventDeliveries(
  app: Database,
  tenantId: string,
  deps: DeliverySendDeps = {},
): Promise<DeliverySendResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? consoleLogger;
  const result: DeliverySendResult = { sent: 0, failed: 0, dead: 0, cancelled: 0, skipped: 0 };
  const channels: DeliveryChannel[] = [
    ...(deps.webhook ? (['webhook'] as const) : []),
    ...(deps.mail ? (['email'] as const) : []),
  ];
  const missing = (['webhook', 'email'] as const).filter((channel) => !channels.includes(channel));
  let budget = Math.max(0, Math.min(deps.limit ?? 20, 100));
  const lane = async () => {
    while (channels.length > 0 && budget > 0 && !deps.signal?.aborted) {
      budget--;
      const claim = await claimNext(app, tenantId, channels, now());
      if (claim.kind === 'none') {
        budget = 0;
        break;
      }
      let settled: Settled;
      if (claim.kind === 'settled') settled = claim.outcome;
      else if (claim.kind === 'webhook' && deps.webhook)
        settled = await sendWebhook(app, tenantId, claim, { ...deps, webhook: deps.webhook }, now, log);
      else if (claim.kind === 'email' && deps.mail)
        settled = await sendEmail(app, tenantId, claim, { ...deps, mail: deps.mail }, now, log);
      else settled = 'aborted';
      if (settled !== 'aborted') result[settled]++;
    }
  };
  const lanes = await Promise.allSettled(
    Array.from({ length: Math.max(1, Math.min(deps.concurrency ?? 4, 16)) }, lane),
  );
  const failure = lanes.find((lane): lane is PromiseRejectedResult => lane.status === 'rejected');
  if (failure) throw failure.reason;
  if (missing.length > 0) {
    const [row] = await withContext(app, systemParams(tenantId, null), (ctx) =>
      ctx.db
        .select({ n: count() })
        .from(eventDeliveries)
        .where(dueCondition(tenantId, now(), missing)),
    );
    result.skipped = Number(row?.n ?? 0);
  }
  return result;
}

/** Deletes delivered and cancelled rows older than the retention period (AC-21); dead and pending rows are kept. */
export async function purgeEventDeliveries(ctx: Context, now: Date = ctx.now()): Promise<number> {
  const cutoff = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * 86_400_000);
  const ids = await ctx.db
    .select({ id: eventDeliveries.id })
    .from(eventDeliveries)
    .where(
      and(
        eq(eventDeliveries.tenantId, ctx.tenantId),
        or(
          and(eq(eventDeliveries.status, 'delivered'), lt(eventDeliveries.deliveredAt, cutoff)),
          and(eq(eventDeliveries.status, 'cancelled'), lt(eventDeliveries.cancelledAt, cutoff)),
        ),
      ),
    )
    .limit(PURGE_BATCH);
  if (ids.length === 0) return 0;
  const deleted = await ctx.db
    .delete(eventDeliveries)
    .where(
      and(
        eq(eventDeliveries.tenantId, ctx.tenantId),
        inArray(
          eventDeliveries.id,
          ids.map((r) => r.id),
        ),
      ),
    )
    .returning({ id: eventDeliveries.id });
  return deleted.length;
}

// ---------------------------------------------------------------------------------------------------------------
// Administration (AC-19, AC-20, AC-22)

/** Company administrators only: a user actor (allow-list) with the admin role and company-wide access. */
export function assertEventAdmin(ctx: Context, op: string): void {
  if (ctx.actor.type !== 'user' || !isAdmin(ctx) || (ctx.accessScope ?? 'all') !== 'all')
    throw new PermissionDenied('event_delivery', op, ctx.roles);
}

export const DELIVERY_LIST_STATUSES = ['dead', 'pending', 'cancelled', 'delivered'] as const;
export type DeliveryListStatus = (typeof DELIVERY_LIST_STATUSES)[number];

export const deliveryListQuerySchema = z
  .object({
    status: z.enum(DELIVERY_LIST_STATUSES).default('dead'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.string().max(200).optional(),
  })
  .strict();
export type DeliveryListQuery = z.input<typeof deliveryListQuerySchema>;

export interface DeliveryListItem {
  id: string;
  kind: 'webhook' | 'email' | 'internal';
  target: { endpointId?: string; endpointLabel?: string; userName?: string };
  topic: string;
  eventId: string;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  lastStatus?: number;
  createdAt: string;
  nextAttemptAt?: string;
  deliveredAt?: string;
  deadAt?: string;
  cancelledAt?: string;
}

export interface DeliveryList {
  items: DeliveryListItem[];
  counts: Record<DeliveryListStatus, number>;
  nextCursor: string | null;
}

interface Cursor {
  at: Date;
  id: string;
}

function encodeCursor(item: { createdAt: string; id: string }): string {
  return Buffer.from(`${item.createdAt}|${item.id}`, 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): Cursor | null {
  if (value === undefined) return null;
  const [at, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  const date = at ? new Date(at) : new Date(Number.NaN);
  if (!id || !isUuid(id) || Number.isNaN(date.getTime()))
    throw new ValidationError('invalid cursor', [{ path: 'query.before', message: 'invalid cursor' }]);
  return { at: date, id };
}

type InternalRow = Pick<
  typeof outbox.$inferSelect,
  'id' | 'topic' | 'attempts' | 'lastError' | 'createdAt' | 'nextAttemptAt' | 'deadAt'
>;

function internalItem(row: InternalRow): DeliveryListItem {
  const item: DeliveryListItem = {
    id: row.id,
    kind: 'internal',
    target: {},
    topic: row.topic,
    eventId: row.id,
    status: row.deadAt ? 'dead' : 'pending',
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
  if (row.nextAttemptAt && !row.deadAt) item.nextAttemptAt = row.nextAttemptAt.toISOString();
  if (row.deadAt) item.deadAt = row.deadAt.toISOString();
  return item;
}

async function deliveryItems(ctx: Context, rows: readonly Row[]): Promise<DeliveryListItem[]> {
  const labels = new Map<string, string>();
  if (rows.some((r) => r.channel === 'webhook')) {
    const company = await getCompany(ctx);
    for (const endpoint of integrationWebhooksOf(company.settings).value.endpoints)
      labels.set(endpoint.id, endpoint.label);
  }
  const userIds = [...new Set(rows.filter((r) => r.channel === 'email' && isUuid(r.target)).map((r) => r.target))];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const people = await ctx.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, ctx.tenantId), inArray(users.id, userIds)));
    for (const person of people) names.set(person.id, person.name);
  }
  return rows.map((row) => {
    const target: DeliveryListItem['target'] = {};
    if (row.channel === 'webhook') {
      target.endpointId = row.target;
      const endpointLabel = labels.get(row.target);
      if (endpointLabel) target.endpointLabel = endpointLabel;
    } else {
      const userName = names.get(row.target);
      if (userName) target.userName = userName;
    }
    const item: DeliveryListItem = {
      id: row.id,
      kind: row.channel,
      target,
      topic: row.topic,
      eventId: row.eventId,
      status: row.status,
      attempts: row.attempts,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
    };
    if (row.lastStatus !== null) item.lastStatus = row.lastStatus;
    if (row.status === 'pending' || row.status === 'sending') item.nextAttemptAt = row.nextAttemptAt.toISOString();
    if (row.deliveredAt) item.deliveredAt = row.deliveredAt.toISOString();
    if (row.deadAt) item.deadAt = row.deadAt.toISOString();
    if (row.cancelledAt) item.cancelledAt = row.cancelledAt.toISOString();
    return item;
  });
}

function companyScope(ctx: Context): string {
  if (!ctx.companyId) throw new NotFound('company', 'null');
  return ctx.companyId;
}

function internalCondition(ctx: Context, companyId: string, status: 'dead' | 'pending'): SQL | undefined {
  return and(
    eq(outbox.tenantId, ctx.tenantId),
    eq(outbox.companyId, companyId),
    isNull(outbox.publishedAt),
    status === 'dead' ? isNotNull(outbox.deadAt) : and(isNull(outbox.deadAt), isNotNull(outbox.lastError)),
  );
}

/**
 * The company's delivery rows of one status, newest first, with internal outbox rows (dead, or failed and waiting) mixed
 * in for `dead` / `pending` (AC-19). Never returns bodies, payloads, URLs, addresses, secrets or raw errors.
 */
export async function listEventDeliveries(ctx: Context, query: DeliveryListQuery = {}): Promise<DeliveryList> {
  assertEventAdmin(ctx, 'read');
  const parsed = deliveryListQuerySchema.safeParse(query);
  if (!parsed.success)
    throw new ValidationError(
      'invalid delivery list query',
      parsed.error.issues.map((i) => ({ path: ['query', ...i.path.map(String)].join('.'), message: i.message })),
    );
  const { status, limit, before } = parsed.data;
  const cursor = decodeCursor(before);
  const companyId = companyScope(ctx);
  const statuses: DeliveryStatus[] = status === 'pending' ? ['pending', 'sending'] : [status];
  const rows = await ctx.db
    .select()
    .from(eventDeliveries)
    .where(
      and(
        eq(eventDeliveries.tenantId, ctx.tenantId),
        eq(eventDeliveries.companyId, companyId),
        inArray(eventDeliveries.status, statuses),
        cursor
          ? or(
              lt(eventDeliveries.createdAt, cursor.at),
              and(eq(eventDeliveries.createdAt, cursor.at), lt(eventDeliveries.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(eventDeliveries.createdAt), desc(eventDeliveries.id))
    .limit(limit + 1);
  let items = await deliveryItems(ctx, rows);
  if (status === 'dead' || status === 'pending') {
    const internal = await ctx.db
      .select({
        id: outbox.id,
        topic: outbox.topic,
        attempts: outbox.attempts,
        lastError: outbox.lastError,
        createdAt: outbox.createdAt,
        nextAttemptAt: outbox.nextAttemptAt,
        deadAt: outbox.deadAt,
      })
      .from(outbox)
      .where(
        and(
          internalCondition(ctx, companyId, status),
          cursor
            ? or(lt(outbox.createdAt, cursor.at), and(eq(outbox.createdAt, cursor.at), lt(outbox.id, cursor.id)))
            : undefined,
        ),
      )
      .orderBy(desc(outbox.createdAt), desc(outbox.id))
      .limit(limit + 1);
    items = [...items, ...internal.map(internalItem)].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
  }
  const page = items.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page,
    counts: await deliveryCounts(ctx, companyId),
    nextCursor: items.length > limit && last ? encodeCursor(last) : null,
  };
}

async function deliveryCounts(ctx: Context, companyId: string): Promise<Record<DeliveryListStatus, number>> {
  const counts: Record<DeliveryListStatus, number> = { dead: 0, pending: 0, cancelled: 0, delivered: 0 };
  const grouped = await ctx.db
    .select({ status: eventDeliveries.status, n: count() })
    .from(eventDeliveries)
    .where(and(eq(eventDeliveries.tenantId, ctx.tenantId), eq(eventDeliveries.companyId, companyId)))
    .groupBy(eventDeliveries.status);
  for (const g of grouped) {
    const key: DeliveryListStatus = g.status === 'sending' ? 'pending' : (g.status as DeliveryListStatus);
    if (key in counts) counts[key] += Number(g.n);
  }
  for (const status of ['dead', 'pending'] as const) {
    const [row] = await ctx.db
      .select({ n: count() })
      .from(outbox)
      .where(internalCondition(ctx, companyId, status));
    counts[status] += Number(row?.n ?? 0);
  }
  return counts;
}

/**
 * Puts one `dead` row back to pending with the same delivery id (AC-20): a delivery row gets 0 attempts and is due now;
 * an internal outbox row loses dead_at and its attempts so subscribers and routing run again. last_error is kept until
 * the next attempt, so the row shows in the pending tab. Audited as `event_delivery` op `retry`.
 */
export async function retryEventDelivery(ctx: Context, id: string): Promise<DeliveryListItem> {
  assertEventAdmin(ctx, 'retry');
  const companyId = companyScope(ctx);
  if (!isUuid(id)) throw new NotFound('event_delivery', id);
  const now = ctx.now();
  const [row] = await ctx.db
    .select()
    .from(eventDeliveries)
    .where(
      and(
        eq(eventDeliveries.tenantId, ctx.tenantId),
        eq(eventDeliveries.companyId, companyId),
        eq(eventDeliveries.id, id),
      ),
    )
    .limit(1)
    .for('update');
  if (row) {
    if (row.status !== 'dead') throw notDead(id);
    const [updated] = await ctx.db
      .update(eventDeliveries)
      .set({ status: 'pending', attempts: 0, nextAttemptAt: now, deadAt: null, leaseId: null, leaseUntil: null })
      .where(eq(eventDeliveries.id, id))
      .returning();
    await writeAudit(ctx, 'event_delivery', id, 'retry', { status: 'dead' }, { status: 'pending', kind: row.channel });
    const [item] = await deliveryItems(ctx, updated ? [updated] : []);
    if (!item) throw new NotFound('event_delivery', id);
    return item;
  }
  const [event] = await ctx.db
    .select()
    .from(outbox)
    .where(and(eq(outbox.tenantId, ctx.tenantId), eq(outbox.companyId, companyId), eq(outbox.id, id)))
    .limit(1)
    .for('update');
  if (!event) throw new NotFound('event_delivery', id);
  if (!event.deadAt || event.publishedAt) throw notDead(id);
  const [updated] = await ctx.db
    .update(outbox)
    .set({ deadAt: null, attempts: 0, nextAttemptAt: null })
    .where(eq(outbox.id, id))
    .returning();
  await writeAudit(ctx, 'event_delivery', id, 'retry', { status: 'dead' }, { status: 'pending', kind: 'internal' });
  return internalItem(updated ?? { ...event, deadAt: null, attempts: 0, nextAttemptAt: null });
}

function notDead(id: string): StateError {
  return new StateError(`event delivery ${id} is not dead`, 'Only failed (dead) deliveries can be resent.', { id });
}
