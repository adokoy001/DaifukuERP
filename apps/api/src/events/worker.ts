// Business event delivery worker (docs/specs/event-delivery.md AC-1..AC-3, ADR-0037). One tick lists the tenants with
// due work through a fixed owner read, then per tenant on the app connection (RLS, system context, each step its own
// transaction): up to 10 deliverPending calls of 100 events, up to 20 sends (4 at a time), inbox checks when this
// process can send mail, and the purge of old delivered / cancelled rows. A failing tenant is logged by error class and
// SQLSTATE only, and the others continue. Ticks never overlap: the next one is scheduled after the previous one ends.
import {
  consoleLogger,
  deliverEventDeliveries,
  deliverPending,
  purgeEventDeliveries,
  safeDiagnosticFields,
  systemParams,
  withContext,
  type Database,
  type IdentityMailTransport,
  type Logger,
  type WebhookTransport,
} from '@daifuku/kernel';
import type { EventWorkerConfig } from './config.ts';
import { dueTenantsReader, type DueTenantsReader } from './due-tenants.ts';
import { checkInboxWatches } from './inbox-watch.ts';
import { webhookTransport } from './webhook-transport.ts';

export interface EventWorkerDeps {
  owner: Database;
  app: Database;
  config: EventWorkerConfig;
  /** Identity settings of this process: the encryption key unlocks webhook secrets; the mail transport sends inbox mail. */
  identity?: { encryptionKey: string; webUrl: string; mailTransport?: IdentityMailTransport };
  webhookTransport?: WebhookTransport;
  dueTenants?: DueTenantsReader;
  now?: () => Date;
  log?: Logger;
}

export interface TickResult {
  tenants: number;
  failedTenants: number;
  events: { delivered: number; failed: number; dead: number; routed: number };
  sends: { sent: number; failed: number; dead: number; cancelled: number; skipped: number };
  inbox: { checked: number; changed: number; removed: number; discarded: number };
  purged: number;
}

const EVENT_BATCH = 100;
const EVENT_CALLS = 10;

export function emptyTick(): TickResult {
  return {
    tenants: 0,
    failedTenants: 0,
    events: { delivered: 0, failed: 0, dead: 0, routed: 0 },
    sends: { sent: 0, failed: 0, dead: 0, cancelled: 0, skipped: 0 },
    inbox: { checked: 0, changed: 0, removed: 0, discarded: 0 },
    purged: 0,
  };
}

function add<T extends object>(into: T, from: T): void {
  const target = into as Record<string, number>;
  for (const [key, value] of Object.entries(from))
    if (typeof value === 'number') target[key] = (target[key] ?? 0) + value;
}

/** True when the tick changed something: any counter except the tenant count and the rows this process skipped. */
export function tickDidWork(result: TickResult): boolean {
  const { sent, failed, dead, cancelled } = result.sends;
  const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, n) => total + n, 0);
  return (
    result.failedTenants + result.purged + sent + failed + dead + cancelled + sum(result.events) + sum(result.inbox) > 0
  );
}

const IDLE_LOG_MS = 3_600_000;

/**
 * Whether the periodic worker logs a tick: always when it did work; when it only found rows this process cannot send
 * (no encryption key / SMTP here) at most once an hour, so a tenant that stays due does not log every interval.
 */
export function shouldLogTick(result: TickResult, lastIdleLogAt: number | null, now: number): boolean {
  if (tickDidWork(result)) return true;
  if (result.sends.skipped === 0) return false;
  return lastIdleLogAt === null || now - lastIdleLogAt >= IDLE_LOG_MS;
}

/** CLI exit code (AC-3): 1 when a tenant failed, else 2 when due rows could not be sent for lack of configuration, else 0. */
export function tickExitCode(result: TickResult): 0 | 1 | 2 {
  if (result.failedTenants > 0) return 1;
  return result.sends.skipped > 0 ? 2 : 0;
}

/** One tick over every tenant with due work. */
export async function runEventTick(deps: EventWorkerDeps, signal?: AbortSignal): Promise<TickResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? consoleLogger;
  const transport = deps.webhookTransport ?? webhookTransport({ allowLoopback: deps.config.allowLoopback });
  const result = emptyTick();
  const tenants = await (deps.dueTenants ?? dueTenantsReader(deps.owner))(now());
  for (const tenantId of tenants) {
    if (signal?.aborted) break;
    result.tenants++;
    try {
      for (let call = 0; call < EVENT_CALLS && !signal?.aborted; call++) {
        const delivered = await withContext(deps.app, systemParams(tenantId, null, { now, log }), (ctx) =>
          deliverPending(ctx, EVENT_BATCH),
        );
        add(result.events, delivered);
        if (delivered.delivered + delivered.failed < EVENT_BATCH) break;
      }
      const identity = deps.identity;
      add(
        result.sends,
        await deliverEventDeliveries(deps.app, tenantId, {
          now,
          log,
          ...(signal ? { signal } : {}),
          ...(identity ? { webhook: { transport, encryptionKey: identity.encryptionKey } } : {}),
          ...(identity?.mailTransport ? { mail: { transport: identity.mailTransport, webUrl: identity.webUrl } } : {}),
        }),
      );
      if (identity?.mailTransport && !signal?.aborted)
        add(
          result.inbox,
          await checkInboxWatches(deps.owner, deps.app, tenantId, {
            now,
            intervalMinutes: deps.config.inboxCheckMinutes,
            log,
            ...(signal ? { signal } : {}),
          }),
        );
      result.purged += await withContext(deps.app, systemParams(tenantId, null, { now }), (ctx) =>
        purgeEventDeliveries(ctx),
      );
    } catch (error) {
      result.failedTenants++;
      log.error('event delivery failed for a tenant', { tenantId, ...safeDiagnosticFields(error) });
    }
  }
  return result;
}

export interface EventWorker {
  /** Stops scheduling, waits for the running tick up to `graceMs` (default 15 s), then aborts in-flight sends. */
  stop(graceMs?: number): Promise<void>;
}

/** Starts the periodic worker (AC-1). The first tick runs one interval after start. */
export function startEventWorker(deps: EventWorkerDeps): EventWorker {
  const log = deps.log ?? consoleLogger;
  const controller = new AbortController();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  let lastIdleLogAt: number | null = null;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(tick, deps.config.intervalMs);
  };
  const tick = () => {
    running = runEventTick(deps, controller.signal)
      .then((result) => {
        const at = Date.now();
        if (!shouldLogTick(result, lastIdleLogAt, at)) return;
        if (!tickDidWork(result)) lastIdleLogAt = at;
        log.info('event delivery tick', { ...result });
      })
      .catch((error: unknown) => log.error('event delivery tick failed', safeDiagnosticFields(error)))
      .finally(() => {
        running = null;
        schedule();
      });
  };
  schedule();
  return {
    async stop(graceMs = 15_000) {
      stopped = true;
      if (timer) clearTimeout(timer);
      const current = running;
      if (!current) return;
      const abortTimer = setTimeout(() => controller.abort(), graceMs);
      try {
        await current;
      } finally {
        clearTimeout(abortTimer);
      }
    },
  };
}
