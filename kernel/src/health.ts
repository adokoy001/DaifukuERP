// Setup health (docs/specs/setup-health.md, ADR-0027 §7): read-only checks of a company's configuration and operating
// state. Modules contribute checks with registry.registerHealthCheck; the kernel adds its own (company profile, outbox)
// and apps pass platform checks (mail, SSO, migrations, storage) as `extra`. Each check runs in a savepoint with the
// caller's Context, so it sees only what the caller may read; a check that throws becomes a `warn` item and the others
// still run. Outcomes carry labels and an in-app path only: never secrets, connection strings or file paths.
import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { isAppHref } from './app-href.ts';
import { isAdmin, type Context } from './context.ts';
import { HEALTH_ROLES, hasAnyRole } from './kernel-capabilities.ts';
import { companyProfileOf, companyProfileSchema, COMPANY_PROFILE_KEY } from './company-profile.ts';
import { eventDeliveries } from './db/event-tables.ts';
import { outbox } from './db/system-tables.ts';
import { DaifukuError, PermissionDenied, safeErrorDiagnostics } from './errors.ts';
import { label, type Label } from './i18n.ts';
import { registry, type HealthCheckDef, type HealthOutcome, type HealthStatus } from './registry.ts';
import { getCompany } from './settings.ts';
import { withSavepoint } from './transactions.ts';

export const HEALTH_STATUSES: readonly HealthStatus[] = ['ok', 'warn', 'fail'];

/** One item of GET /meta/health. `id` is stable (the setup wizard uses it as a completion condition). */
export interface HealthItem {
  id: string;
  status: HealthStatus;
  label: Label;
  detail: Label;
  href?: string;
}

export interface HealthReport {
  /** ISO time the checks ran. */
  checkedAt: string;
  items: HealthItem[];
}

/**
 * In-app paths only (AC-8): one leading slash, then letters, digits and `/ _ - . ? = &`; no `//`, no `..`, no scheme.
 * The web app opens it with the router; anything else is dropped from the item. Same rule as `managedBy` (app-href.ts).
 */
export function isHealthHref(href: unknown): href is string {
  return isAppHref(href);
}

function isLabel(value: unknown): value is Label {
  if (typeof value !== 'object' || value === null) return false;
  const l = value as Record<string, unknown>;
  return typeof l.ja === 'string' && l.ja !== '' && typeof l.en === 'string' && l.en !== '';
}

/** Health is read by admin or role `settings` with company-wide access (AC-1), like company settings. */
export function assertHealthAccess(ctx: Context): void {
  if (ctx.accessScope && ctx.accessScope !== 'all') throw new PermissionDenied('setup_health', 'read', ctx.roles);
  if (!hasAnyRole(ctx, HEALTH_ROLES)) throw new PermissionDenied('setup_health', 'read', ctx.roles);
}

const SETTINGS_COMPANY_TAB = '/settings?tab=company';

/** Kernel check: the company profile names the business (its legal name), and the stored value is valid. */
export const COMPANY_PROFILE_CHECK: HealthCheckDef = {
  id: 'company.profile',
  label: label('会社プロフィール', 'Company profile'),
  order: 30,
  run: async (ctx) => {
    const company = await getCompany(ctx);
    const raw = company.settings[COMPANY_PROFILE_KEY];
    if (raw !== undefined && !companyProfileSchema.safeParse(raw).success)
      return {
        status: 'warn',
        detail: label(
          '保存されている会社プロフィールが定義に合いません。会社タブで保存し直してください。',
          'The stored company profile does not match its definition. Save it again on the Company tab.',
        ),
        href: SETTINGS_COMPANY_TAB,
      };
    const profile = companyProfileOf(company.settings);
    if (!profile.legalName)
      return {
        status: 'warn',
        detail: label(
          '正式名称が未入力です。書類には会社名が使われます。',
          'The legal name is not set. Documents use the company name instead.',
        ),
        href: SETTINGS_COMPANY_TAB,
      };
    return {
      status: 'ok',
      detail: label(`正式名称: ${profile.legalName}`, `Legal name: ${profile.legalName}`),
      href: SETTINGS_COMPANY_TAB,
    };
  },
};

/**
 * Kernel check: business event delivery for this company (docs/specs/event-delivery.md AC-24). Events the worker gave up
 * on (dead outbox rows, i.e. internal subscribers that failed 8 times) and dead webhook / email deliveries are `warn`,
 * with a link to the administrators' delivery screen for an administrator. Retrying rows alone are not a warning; the
 * `ok` detail reports undelivered events and deliveries waiting to be sent. No URL, recipient or error text is returned.
 */
export const OUTBOX_CHECK: HealthCheckDef = {
  id: 'system.outbox',
  label: label('業務イベントの配送', 'Business event delivery'),
  order: 90,
  run: async (ctx) => {
    const company = ctx.companyId ? eq(outbox.companyId, ctx.companyId) : isNull(outbox.companyId);
    const undelivered = and(eq(outbox.tenantId, ctx.tenantId), company, isNull(outbox.publishedAt));
    const [pending] = await ctx.db
      .select({ n: count() })
      .from(outbox)
      .where(and(undelivered, isNull(outbox.deadAt)));
    const [deadEvents] = await ctx.db
      .select({ n: count() })
      .from(outbox)
      .where(and(undelivered, isNotNull(outbox.deadAt)));
    const deliveries = ctx.companyId
      ? await ctx.db
          .select({ status: eventDeliveries.status, n: count() })
          .from(eventDeliveries)
          .where(
            and(
              eq(eventDeliveries.tenantId, ctx.tenantId),
              eq(eventDeliveries.companyId, ctx.companyId),
              inArray(eventDeliveries.status, ['pending', 'sending', 'dead']),
            ),
          )
          .groupBy(eventDeliveries.status)
      : [];
    const deadDeliveries = Number(deliveries.find((d) => d.status === 'dead')?.n ?? 0);
    const waitingDeliveries = deliveries
      .filter((d) => d.status === 'pending' || d.status === 'sending')
      .reduce((sum, d) => sum + Number(d.n), 0);
    const failures = Number(deadEvents?.n ?? 0) + deadDeliveries;
    const waiting = Number(pending?.n ?? 0);
    if (failures > 0)
      return {
        status: 'warn',
        detail: label(
          `配送できなかったイベントが ${failures} 件あります。原因を直してから再送してください。`,
          `${failures} event deliveries failed. Fix the cause, then resend them.`,
        ),
        ...(isAdmin(ctx) && ctx.actor.type === 'user' ? { href: '/admin/event-deliveries?status=dead' } : {}),
      };
    return {
      status: 'ok',
      detail: label(
        `未配送のイベント: ${waiting} 件、送信待ち: ${waitingDeliveries} 件`,
        `Undelivered events: ${waiting}; deliveries waiting to be sent: ${waitingDeliveries}`,
      ),
    };
  },
};

export const KERNEL_HEALTH_CHECKS: readonly HealthCheckDef[] = [COMPANY_PROFILE_CHECK, OUTBOX_CHECK];

function failedCheck(def: HealthCheckDef, error: unknown): HealthItem {
  const denied = error instanceof PermissionDenied;
  return {
    id: def.id,
    status: 'warn',
    label: def.label,
    detail: denied
      ? label(
          'この項目を点検する権限がありません（管理者に依頼してください）。',
          'You do not have permission to check this item (ask an administrator).',
        )
      : label(
          '点検できませんでした。時間をおいて再点検してください。',
          'This item could not be checked. Try again later.',
        ),
  };
}

function itemOf(def: HealthCheckDef, outcome: HealthOutcome): HealthItem | null {
  if (!HEALTH_STATUSES.includes(outcome.status) || !isLabel(outcome.detail)) return null;
  const item: HealthItem = { id: def.id, status: outcome.status, label: def.label, detail: outcome.detail };
  if (isHealthHref(outcome.href)) item.href = outcome.href;
  return item;
}

/** Checks in response order: by `order`, then kernel, registered and extra checks in that order. */
export function healthChecks(extra: readonly HealthCheckDef[] = []): HealthCheckDef[] {
  const all = [...KERNEL_HEALTH_CHECKS, ...registry.healthChecks(), ...extra];
  return all
    .map((def, index) => ({ def, index }))
    .sort((a, b) => (a.def.order ?? 1000) - (b.def.order ?? 1000) || a.index - b.index)
    .map((entry) => entry.def);
}

/**
 * Runs every check for the context's company (AC-1, AC-7). Admin or `settings` with company-wide access only. A check
 * that throws, or returns something that is not an outcome, becomes a `warn` item. Nothing of the error is returned;
 * the log gets the error code and, for a non-Daifuku error, only safeErrorDiagnostics (SQLSTATE), never its message.
 */
export async function runHealthChecks(ctx: Context, extra: readonly HealthCheckDef[] = []): Promise<HealthReport> {
  assertHealthAccess(ctx);
  const items: HealthItem[] = [];
  for (const def of healthChecks(extra)) {
    try {
      const outcome = await withSavepoint(ctx, (inner) => def.run(inner));
      items.push(itemOf(def, outcome) ?? failedCheck(def, new Error('invalid outcome')));
    } catch (error) {
      // Diagnostics only (docs/conventions/errors.md): a raw message may carry SQL and bound values, so a non-Daifuku
      // error is logged by its SQLSTATE; a DaifukuError's message is safe by convention.
      ctx.log.warn('health check failed', {
        id: def.id,
        requestId: ctx.requestId,
        ...(error instanceof DaifukuError
          ? { code: error.code, message: error.message }
          : { code: 'INTERNAL', ...safeErrorDiagnostics(error) }),
      });
      items.push(failedCheck(def, error));
    }
  }
  return { checkedAt: ctx.now().toISOString(), items };
}
