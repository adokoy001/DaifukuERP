// Inbox mail, the first delivery subscription (docs/specs/event-delivery.md AC-16..AC-18, ADR-0037). A user asks for
// mail in a company (inbox_watches row); the worker claims due watches, counts the user's inbox in the user's own
// read-only Context (the same `<module>.todo` providers the web inbox runs), and records the observation with
// `inbox.count_changed` in the user's own read-write Context. Routing (event-delivery.ts) turns an increase into one
// email delivery row; the message carries counts and labels only.
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { canRunAction, runAction } from './actions/run.ts';
import type { Context } from './context.ts';
import { withContext, systemParams, type Database } from './db/client.ts';
import { inboxWatches } from './db/event-tables.ts';
import { companies } from './db/system-tables.ts';
import { PermissionDenied, StateError } from './errors.ts';
import { insertOutbox } from './event-insert.ts';
import type { Label } from './i18n.ts';
import { integrationWebhooksOf } from './integration-settings.ts';
import { registry } from './registry.ts';
import { getCompany } from './settings.ts';
import { todoResult, type TodoSeverity } from './todo-result.ts';

export const INBOX_COUNT_CHANGED = 'inbox.count_changed';
const TODO_ACTION = /^[a-z][a-z0-9_]*\.todo$/;
const WATCH_BATCH = 20;

export interface InboxSummaryItem {
  provider: string;
  key: string;
  label: Label;
  count: number;
  severity: TodoSeverity;
}
export interface InboxSummary {
  total: number;
  items: InboxSummaryItem[];
}

/** Self-service notification APIs are for a person: a user actor only (allow-list; agents, relays, machines get 403). */
function assertUserActor(ctx: Context, op: string): string {
  if (ctx.actor.type !== 'user') throw new PermissionDenied('inbox_notification', op, ctx.roles);
  return ctx.actor.id;
}

/** The inbox providers the context may run: the web inbox's isTodoProvider plus canRunAction (AC-16). */
export function inboxProviderNames(ctx: Context): string[] {
  return registry
    .actions()
    .filter((action) => TODO_ACTION.test(action.name) && !action.mutates && !action.generic)
    .filter((action) => canRunAction(ctx, action))
    .map((action) => action.name);
}

/**
 * Runs every runnable provider in the caller's context and sums the counts (hidden-on-screen items included). Throws
 * when any provider fails or returns something that is not a TodoResult: the caller discards that observation.
 */
export async function summarizeInbox(ctx: Context): Promise<InboxSummary> {
  const items: InboxSummaryItem[] = [];
  for (const provider of inboxProviderNames(ctx)) {
    const result = todoResult.parse(await runAction(ctx, provider, {}));
    for (const item of result.items)
      items.push({ provider, key: item.key, label: item.label, count: item.count, severity: item.severity });
  }
  return { total: items.reduce((sum, item) => sum + item.count, 0), items };
}

export interface ClaimedWatch {
  companyId: string;
  userId: string;
}

/**
 * Claims up to 20 due watches of one tenant (system context, FOR UPDATE SKIP LOCKED) and moves their next check one
 * interval ahead, so concurrent workers count each user at most once per interval. Only watches of companies whose
 * `integration.webhooks.inboxEmail` is on are returned (AC-16: counting happens only while the switch is on); the others
 * are advanced without counting and forget their baseline, so the first check after the switch is turned back on records
 * a new baseline instead of mailing about changes made while it was off.
 */
export async function claimInboxWatches(
  app: Database,
  tenantId: string,
  opts: { now: Date; intervalMinutes: number; limit?: number },
): Promise<ClaimedWatch[]> {
  return withContext(app, systemParams(tenantId, null, { now: () => opts.now }), async (ctx) => {
    const rows = await ctx.db
      .select({ companyId: inboxWatches.companyId, userId: inboxWatches.userId })
      .from(inboxWatches)
      .where(and(eq(inboxWatches.tenantId, tenantId), lte(inboxWatches.nextCheckAt, opts.now)))
      .orderBy(asc(inboxWatches.nextCheckAt))
      .limit(Math.max(1, Math.min(opts.limit ?? WATCH_BATCH, 100)))
      .for('update', { skipLocked: true });
    if (rows.length === 0) return [];
    const switches = await ctx.db
      .select({ id: companies.id, settings: companies.settings })
      .from(companies)
      .where(
        and(eq(companies.tenantId, tenantId), inArray(companies.id, [...new Set(rows.map((row) => row.companyId))])),
      );
    const enabled = new Set(
      switches
        .filter(
          (company) => integrationWebhooksOf((company.settings ?? {}) as Record<string, unknown>).value.inboxEmail,
        )
        .map((company) => company.id),
    );
    const next = new Date(opts.now.getTime() + opts.intervalMinutes * 60_000);
    for (const row of rows)
      await ctx.db
        .update(inboxWatches)
        .set(enabled.has(row.companyId) ? { nextCheckAt: next } : { nextCheckAt: next, lastTotal: null })
        .where(
          and(
            eq(inboxWatches.tenantId, tenantId),
            eq(inboxWatches.companyId, row.companyId),
            eq(inboxWatches.userId, row.userId),
          ),
        );
    return rows.filter((row) => enabled.has(row.companyId));
  });
}

/** Worker-only maintenance runs in the system context (a user's or a module's context is refused). */
function assertSystemActor(ctx: Context, op: string): void {
  if (ctx.actor.type !== 'system') throw new PermissionDenied('inbox_watch', op, ctx.roles);
}

/** Removes a watch whose user is inactive or lost the company (system context only; no event). */
export async function removeInboxWatch(ctx: Context, companyId: string, userId: string): Promise<void> {
  assertSystemActor(ctx, 'remove');
  await ctx.db
    .delete(inboxWatches)
    .where(
      and(
        eq(inboxWatches.tenantId, ctx.tenantId),
        eq(inboxWatches.companyId, companyId),
        eq(inboxWatches.userId, userId),
      ),
    );
}

/**
 * Records one observation in the user's own read-write Context (AC-16): under the watch's row lock, the first
 * observation is only a baseline; a different total updates the record and emits `inbox.count_changed`; the same total
 * changes nothing but the observation time. Returns whether an event was written ('gone' when the watch was removed).
 */
export async function recordInboxObservation(
  ctx: Context,
  summary: InboxSummary,
): Promise<'baseline' | 'changed' | 'unchanged' | 'gone'> {
  const userId = assertUserActor(ctx, 'observe');
  if (!ctx.companyId) return 'gone';
  const key = and(
    eq(inboxWatches.tenantId, ctx.tenantId),
    eq(inboxWatches.companyId, ctx.companyId),
    eq(inboxWatches.userId, userId),
  );
  const [watch] = await ctx.db.select().from(inboxWatches).where(key).limit(1).for('update');
  if (!watch) return 'gone';
  const now = ctx.now();
  if (watch.lastTotal === null) {
    await ctx.db.update(inboxWatches).set({ lastTotal: summary.total, observedAt: now }).where(key);
    return 'baseline';
  }
  if (watch.lastTotal === summary.total) {
    await ctx.db.update(inboxWatches).set({ observedAt: now }).where(key);
    return 'unchanged';
  }
  await ctx.db.update(inboxWatches).set({ lastTotal: summary.total, observedAt: now }).where(key);
  // Kernel-reserved topic (event-insert.ts): ctx.emit refuses it, so no other code path can name a mail recipient.
  await insertOutbox(ctx, INBOX_COUNT_CHANGED, {
    userId,
    total: summary.total,
    previousTotal: watch.lastTotal,
    items: summary.items,
  });
  return 'changed';
}

export interface InboxNotification {
  inboxEmail: boolean;
  available: boolean;
  reason?: 'company_disabled' | 'mail_not_configured';
}

/** The caller's own inbox mail registration in the current company (AC-18). */
export async function getInboxNotification(
  ctx: Context,
  opts: { mailConfigured: boolean },
): Promise<InboxNotification> {
  const userId = assertUserActor(ctx, 'read');
  const company = await getCompany(ctx);
  const watch = await ctx.db
    .select({ userId: inboxWatches.userId })
    .from(inboxWatches)
    .where(
      and(
        eq(inboxWatches.tenantId, ctx.tenantId),
        eq(inboxWatches.companyId, company.id),
        eq(inboxWatches.userId, userId),
      ),
    )
    .limit(1);
  const out: InboxNotification = { inboxEmail: watch.length > 0, available: true };
  if (!integrationWebhooksOf(company.settings).value.inboxEmail) {
    out.available = false;
    out.reason = 'company_disabled';
  } else if (!opts.mailConfigured) {
    out.available = false;
    out.reason = 'mail_not_configured';
  }
  return out;
}

/**
 * Turns the caller's own inbox mail on or off in the current company (AC-18). Turning it on needs the company switch
 * and a mail transport (409 otherwise); turning it off always succeeds. Store/site-scoped members may register too: the
 * count is always made in their own scope.
 */
export async function setInboxNotification(
  ctx: Context,
  enabled: boolean,
  opts: { mailConfigured: boolean },
): Promise<InboxNotification> {
  const userId = assertUserActor(ctx, 'update');
  const company = await getCompany(ctx);
  const key = and(
    eq(inboxWatches.tenantId, ctx.tenantId),
    eq(inboxWatches.companyId, company.id),
    eq(inboxWatches.userId, userId),
  );
  if (!enabled) {
    await ctx.db.delete(inboxWatches).where(key);
    return getInboxNotification(ctx, opts);
  }
  if (!integrationWebhooksOf(company.settings).value.inboxEmail)
    throw new StateError(
      'inbox mail is not enabled for this company',
      'Ask an administrator to turn on inbox mail in the integration settings (integration.webhooks.inboxEmail).',
      { reason: 'company_disabled' },
    );
  if (!opts.mailConfigured)
    throw new StateError(
      'mail delivery is not configured on this server',
      'Ask the operator to configure SMTP (SMTP_*), IDENTITY_ENCRYPTION_KEY and PUBLIC_WEB_URL.',
      { reason: 'mail_not_configured' },
    );
  const now = ctx.now();
  await ctx.db
    .insert(inboxWatches)
    .values({ tenantId: ctx.tenantId, companyId: company.id, userId, nextCheckAt: now, createdAt: now })
    .onConflictDoNothing();
  return getInboxNotification(ctx, opts);
}

interface MessageItem {
  label: Label;
  count: number;
}

function messageItems(payload: unknown): MessageItem[] {
  const raw = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const item = entry as Partial<MessageItem> | null;
    const l = item?.label as Partial<Label> | undefined;
    if (!item || typeof l?.ja !== 'string' || typeof l.en !== 'string' || !Number.isSafeInteger(item.count)) return [];
    return [{ label: { ja: l.ja.slice(0, 200), en: l.en.slice(0, 200) }, count: item.count as number }];
  });
}

const numberOf = (value: unknown): number => (Number.isSafeInteger(value) ? (value as number) : 0);

/**
 * The inbox mail (AC-17): Japanese then English in one message, with the company name, the previous and current totals,
 * each item's label and count, a note that the count may include items the inbox screen hides, the link to the inbox
 * and how to stop. No other business data.
 */
export function inboxEmailMessage(input: { companyName: string; payload: unknown; webUrl: string }): {
  subject: string;
  text: string;
} {
  const p = input.payload as { total?: unknown; previousTotal?: unknown } | null;
  const total = numberOf(p?.total);
  const previous = numberOf(p?.previousTotal);
  const items = messageItems(input.payload);
  const inbox = `${input.webUrl.replace(/\/+$/, '')}/inbox`;
  const company = input.companyName.slice(0, 200);
  const ja = [
    `${company} の受信箱のやることが ${previous} 件から ${total} 件に増えました。`,
    '',
    ...items.map((item) => `・${item.label.ja}: ${item.count} 件`),
    '',
    '件数には、受信箱の画面に表示されない項目が含まれることがあります。',
    `受信箱を開く: ${inbox}`,
    'このメールを止めるには、受信箱の「件数が増えたらメールで知らせる」をオフにしてください。',
  ];
  const en = [
    `Your to-dos in ${company} increased from ${previous} to ${total}.`,
    '',
    ...items.map((item) => `- ${item.label.en}: ${item.count}`),
    '',
    'The count may include items that the inbox screen does not show.',
    `Open the inbox: ${inbox}`,
    'To stop these emails, turn off “Email me when my to-dos increase” on the inbox screen.',
  ];
  return {
    subject: `[Daifuku] 受信箱のやることが増えました（${total} 件） / Your inbox has more to-dos (${total})`,
    text: [...ja, '', '----', '', ...en, ''].join('\n'),
  };
}
