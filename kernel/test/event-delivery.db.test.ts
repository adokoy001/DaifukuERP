// docs/specs/event-delivery.md: outbox retry and dead rows (AC-4, AC-5), routing (AC-6, AC-7), the send loop with a
// fake transport (AC-8..AC-12, AC-17), write-only secrets (AC-14), inbox observations (AC-16, AC-18), administration
// (AC-19..AC-21) and the kernel functions' own access checks (AC-22). Time is injected on both sides of every comparison.
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ContextParams, Logger } from '../src/context.ts';
import { systemParams, withContext } from '../src/db/client.ts';
import { eventDeliveries, inboxWatches, webhookSecrets } from '../src/db/event-tables.ts';
import { auditLog, companies, companyMemberships, outbox, users } from '../src/db/system-tables.ts';
import {
  deliverEventDeliveries,
  listEventDeliveries,
  purgeEventDeliveries,
  retryDelaySeconds,
  retryEventDelivery,
  routeEvent,
  type DeliverySendDeps,
  type WebhookOutcome,
  type WebhookRequest,
  type WebhookTransport,
} from '../src/event-delivery.ts';
import { deliverPending } from '../src/events.ts';
import { unseal } from '../src/identity/crypto.ts';
import type { IdentityMailPayload, IdentityMailTransport } from '../src/identity/mail.ts';
import { newId } from '../src/ids.ts';
import {
  getInboxNotification,
  INBOX_COUNT_CHANGED,
  recordInboxObservation,
  setInboxNotification,
} from '../src/inbox-watch.ts';
import { integrationWebhooksSchema, INTEGRATION_WEBHOOKS_KEY } from '../src/integration-settings.ts';
import { registry } from '../src/registry.ts';
import { setSetting } from '../src/settings.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { issueWebhookSecret, webhookEndpoints } from '../src/webhook-secrets.ts';
import { verifyWebhookSignature } from '../src/webhook-signing.ts';

let db: TestDb;
let companyB: string;
const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const T0 = new Date('2026-10-30T00:00:00.000Z').getTime();
const at = (seconds: number) => new Date(T0 + seconds * 1000);
const URL_A = 'https://hooks.example.com/a';
const URL_B = 'https://hooks.example.com/b';

interface Sent extends WebhookRequest {
  at: number;
}
class FakeTransport implements WebhookTransport {
  requests: Sent[] = [];
  outcome: WebhookOutcome = { ok: true, status: 204 };
  gate: Promise<void> | null = null;
  async send(request: WebhookRequest): Promise<WebhookOutcome> {
    this.requests.push({ ...request, at: Date.now() });
    if (this.gate) await this.gate;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return this.outcome;
  }
}
class FakeMail implements IdentityMailTransport {
  messages: (IdentityMailPayload & { messageId: string })[] = [];
  fail = false;
  async send(message: IdentityMailPayload & { messageId: string }): Promise<void> {
    if (this.fail) throw new Error('smtp down with secret-ish text');
    this.messages.push(message);
  }
}

const endpoint = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  label: `Endpoint ${id}`,
  url: URL_A,
  topics: ['test.routed'],
  enabled: true,
  ...patch,
});

async function setWebhooks(value: unknown, now = at(0), companyId = db.companyId): Promise<void> {
  await db.run({ now: () => now, companyId }, (ctx) =>
    setSetting(ctx, INTEGRATION_WEBHOOKS_KEY, integrationWebhooksSchema, value),
  );
}
const issue = (endpointId: string, now: Date, encryptionKey: string | undefined = KEY) =>
  db.run({ now: () => now }, (ctx) => issueWebhookSecret(ctx, endpointId, { encryptionKey }));
const issueWithoutKey = (endpointId: string, now: Date) =>
  db.run({ now: () => now }, (ctx) => issueWebhookSecret(ctx, endpointId, { encryptionKey: undefined }));
const emit = (topic: string, payload: unknown, now: Date, companyId: string | null = db.companyId) =>
  db.run({ now: () => now, companyId }, async (ctx) => {
    await ctx.emit(topic, payload);
  });
const deliver = (now: Date, log?: Logger) =>
  withContext(db.app, systemParams(db.tenantId, null, { now: () => now, ...(log ? { log } : {}) }), (ctx) =>
    deliverPending(ctx),
  );
const send = (transport: WebhookTransport, now: Date, extra: Partial<DeliverySendDeps> = {}) =>
  deliverEventDeliveries(db.app, db.tenantId, { now: () => now, webhook: { transport, encryptionKey: KEY }, ...extra });
const deliveries = () => db.owner.drizzle.select().from(eventDeliveries).orderBy(eventDeliveries.createdAt);
const outboxRow = async (topic: string) =>
  (await db.owner.drizzle.select().from(outbox).where(eq(outbox.topic, topic)))[0];

function capture(): { log: Logger; text: () => string } {
  const lines: unknown[] = [];
  return {
    log: {
      info: (msg, data) => lines.push([msg, data]),
      warn: (msg, data) => lines.push([msg, data]),
      error: (msg, data) => lines.push([msg, data]),
    },
    text: () => JSON.stringify(lines),
  };
}

beforeAll(async () => {
  db = await freshDb();
  companyB = newId();
  await db.owner.drizzle
    .insert(companies)
    .values({ id: companyB, tenantId: db.tenantId, code: 'B', name: 'Company B' });
  registry.subscribe('test.fail', async () => {
    throw new Error('secret-ish text from the driver: select * from users where token = abc');
  });
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.owner.sql`delete from event_deliveries`;
  await db.owner.sql`delete from webhook_secrets`;
  await db.owner.sql`delete from inbox_watches`;
  await db.owner.sql`delete from outbox`;
  await db.owner.sql`update companies set settings = settings - 'integration.webhooks'`;
});

describe('outbox retry (AC-4, AC-5)', () => {
  it('AC-4 a failing subscriber is retried on schedule with a safe last_error and log, and is dead at the 8th attempt', async () => {
    await emit('test.fail', {}, at(0));
    const captured = capture();
    let now = at(0);
    for (let attempt = 1; attempt <= 8; attempt++) {
      const result = await deliver(now, captured.log);
      expect(result.failed).toBe(1);
      const row = await outboxRow('test.fail');
      expect(row?.attempts).toBe(attempt);
      expect(row?.lastError).toBe('INTERNAL');
      if (attempt < 8) {
        const due = new Date(now.getTime() + retryDelaySeconds(attempt) * 1000);
        expect(row?.nextAttemptAt?.toISOString()).toBe(due.toISOString());
        expect(row?.deadAt).toBeNull();
        expect((await deliver(new Date(due.getTime() - 1000))).failed).toBe(0);
        now = due;
      } else {
        expect(row?.deadAt?.toISOString()).toBe(now.toISOString());
        expect(result.dead).toBe(1);
      }
    }
    expect((await deliver(at(10 ** 6))).failed).toBe(0);
    expect(captured.text()).toContain('outbox delivery failed');
    expect(captured.text()).not.toContain('secret-ish');
    expect(captured.text()).not.toContain('select *');
  });

  it('AC-5 routing the same event twice creates no second delivery row (unique event, channel and target)', async () => {
    await setWebhooks({ endpoints: [endpoint('dup')], inboxEmail: false });
    await issue('dup', at(0));
    await emit('test.routed', { n: 1 }, at(10));
    expect((await deliver(at(20))).routed).toBe(1);
    const event = await outboxRow('test.routed');
    const settings = (await db.owner.drizzle.select().from(companies).where(eq(companies.id, db.companyId)))[0]
      ?.settings as Record<string, unknown>;
    const again = await db.run({ now: () => at(30) }, (ctx) =>
      routeEvent(
        ctx,
        { id: event?.id ?? '', topic: 'test.routed', payload: {}, companyId: db.companyId, createdAt: at(10) },
        settings,
      ),
    );
    expect(again).toBe(0);
    expect(await deliveries()).toHaveLength(1);
  });
});

describe('routing (AC-6, AC-7)', () => {
  it('AC-6 routes to each enabled, subscribed, signed and activated endpoint and to no other', async () => {
    await setWebhooks({
      endpoints: [
        endpoint('ok'),
        endpoint('prefix', { topics: ['test.*'] }),
        endpoint('disabled', { enabled: false }),
        endpoint('other', { topics: ['test.other'] }),
        endpoint('unsigned'),
        endpoint('moved'),
        endpoint('late'),
      ],
      inboxEmail: false,
    });
    for (const id of ['ok', 'prefix', 'disabled', 'other', 'moved']) await issue(id, at(0));
    await issue('late', at(100));
    const current = (await db.owner.drizzle.select().from(companies).where(eq(companies.id, db.companyId)))[0]
      ?.settings as Record<string, { endpoints: { id: string; url: string }[] }>;
    const value = current[INTEGRATION_WEBHOOKS_KEY];
    await setWebhooks({
      ...value,
      endpoints: value?.endpoints.map((e) => (e.id === 'moved' ? { ...e, url: URL_B } : e)),
    });
    await emit('test.routed', { invoice: 'INV-1' }, at(50));
    await emit('test.routed', { invoice: 'none' }, at(50), null);
    const result = await deliver(at(60));
    expect(result.delivered).toBe(2);
    const rows = await deliveries();
    expect(rows.map((r) => r.target).sort()).toEqual(['ok', 'prefix']);
    expect(rows[0]).toMatchObject({ channel: 'webhook', status: 'pending', attempts: 0, topic: 'test.routed' });
    expect(rows[0]?.payload).toEqual({ invoice: 'INV-1' });
    expect(rows[0]?.eventCreatedAt.toISOString()).toBe(at(50).toISOString());
  });

  it('AC-6 a stored value that no longer matches the schema routes nowhere and logs a warning', async () => {
    await db.owner
      .sql`update companies set settings = settings || ${JSON.stringify({ [INTEGRATION_WEBHOOKS_KEY]: { endpoints: 'x' } })}::jsonb where id = ${db.companyId}`;
    await emit('test.routed', {}, at(0));
    const captured = capture();
    expect((await deliver(at(1), captured.log)).delivered).toBe(1);
    expect(await deliveries()).toHaveLength(0);
    expect(captured.text()).toContain('invalid company setting');
  });

  it('AC-6 (d) the same URL keeps its activation on reissue; a new URL is activated by the next issue', async () => {
    await setWebhooks({ endpoints: [endpoint('e1')], inboxEmail: false });
    await issue('e1', at(100));
    await emit('test.routed', { n: 'before activation' }, at(50));
    await issue('e1', at(200));
    const [secret] = await db.owner.drizzle.select().from(webhookSecrets);
    expect(secret?.activatedAt.toISOString()).toBe(at(100).toISOString());
    expect(secret?.issuedAt.toISOString()).toBe(at(200).toISOString());
    await emit('test.routed', { n: 'after activation' }, at(150));
    await deliver(at(210));
    expect((await deliveries()).map((r) => (r.payload as { n: string }).n)).toEqual(['after activation']);
    await setWebhooks({ endpoints: [endpoint('e1', { url: URL_B })], inboxEmail: false }, at(300));
    await emit('test.routed', { n: 'URL changed, not reissued' }, at(310));
    await deliver(at(320));
    await issue('e1', at(400));
    const [moved] = await db.owner.drizzle.select().from(webhookSecrets);
    expect(moved?.activatedAt.toISOString()).toBe(at(400).toISOString());
    await emit('test.routed', { n: 'before new activation' }, at(350));
    await emit('test.routed', { n: 'after new activation' }, at(450));
    await deliver(at(460));
    expect((await deliveries()).map((r) => (r.payload as { n: string }).n)).toEqual([
      'after activation',
      'after new activation',
    ]);
  });

  it('AC-7 an inbox increase of a registered user creates one email row; a decrease or the same total creates none', async () => {
    await setWebhooks({ endpoints: [endpoint('all', { topics: ['test.*'] })], inboxEmail: true });
    await issue('all', at(0));
    await db.run({ now: () => at(0) }, (ctx) => setInboxNotification(ctx, true, { mailConfigured: true }));
    const observe = (total: number, now: Date) =>
      db.run({ now: () => now }, (ctx) =>
        recordInboxObservation(ctx, {
          total,
          items: [
            {
              provider: 'test.todo',
              key: 'k',
              label: { ja: '承認待ち', en: 'To approve' },
              count: total,
              severity: 'warn',
            },
          ],
        }),
      );
    expect(await observe(2, at(10))).toBe('baseline');
    expect(await observe(2, at(20))).toBe('unchanged');
    expect(await observe(5, at(30))).toBe('changed');
    expect(await observe(3, at(40))).toBe('changed');
    await deliver(at(50));
    const rows = await deliveries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: 'email', target: db.adminUserId, topic: INBOX_COUNT_CHANGED });
    expect(rows[0]?.payload).toMatchObject({ userId: db.adminUserId, total: 5, previousTotal: 2 });
    const events = await db.owner.drizzle.select().from(outbox).where(eq(outbox.topic, INBOX_COUNT_CHANGED));
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.publishedAt !== null)).toBe(true);
  });
});

describe('sending (AC-8..AC-12, AC-17)', () => {
  async function oneRow(id = 'e1', topic = 'test.routed', payload: unknown = { invoice: 'INV-9' }) {
    await setWebhooks({ endpoints: [endpoint(id)], inboxEmail: false });
    const issued = await issue(id, at(0));
    await emit(topic, payload, at(10));
    await deliver(at(20));
    return issued.secret;
  }

  it('AC-8 AC-9 AC-10 retries with the same delivery id and signature, then is dead after the 8th failure', async () => {
    const secret = await oneRow();
    const transport = new FakeTransport();
    transport.outcome = { ok: false, code: 'http_status', status: 500 };
    let now = at(30);
    for (let attempt = 1; attempt <= 8; attempt++) {
      const result = await send(transport, now);
      const [row] = await deliveries();
      expect(row?.attempts).toBe(attempt);
      expect(row?.lastError).toBe('http_status');
      expect(row?.lastStatus).toBe(500);
      if (attempt < 8) {
        expect(result.failed).toBe(1);
        expect(row?.status).toBe('pending');
        const due = new Date(now.getTime() + retryDelaySeconds(attempt) * 1000);
        expect(row?.nextAttemptAt.toISOString()).toBe(due.toISOString());
        expect((await send(transport, new Date(due.getTime() - 1000))).failed).toBe(0);
        now = due;
      } else {
        expect(result.dead).toBe(1);
        expect(row?.status).toBe('dead');
      }
    }
    expect(transport.requests).toHaveLength(8);
    const [row] = await deliveries();
    const ids = new Set(transport.requests.map((r) => r.headers['daifuku-delivery-id']));
    expect([...ids]).toEqual([row?.id]);
    for (const request of transport.requests) {
      expect(request.url).toBe(URL_A);
      expect(
        verifyWebhookSignature(
          secret,
          request.headers['daifuku-delivery-id'] ?? '',
          request.headers['daifuku-timestamp'] ?? '',
          request.body,
          request.headers['daifuku-signature'],
        ),
      ).toBe(true);
      expect(JSON.parse(request.body)).toMatchObject({
        deliveryId: row?.id,
        eventId: row?.eventId,
        topic: 'test.routed',
        occurredAt: at(10).toISOString(),
        companyId: db.companyId,
        data: { invoice: 'INV-9' },
      });
    }
    expect(await send(transport, at(10 ** 6))).toMatchObject({ sent: 0, failed: 0 });
  });

  it('AC-9 a 2xx is delivered with its status code', async () => {
    await oneRow();
    const transport = new FakeTransport();
    expect(await send(transport, at(30))).toMatchObject({ sent: 1 });
    const [row] = await deliveries();
    expect(row).toMatchObject({ status: 'delivered', lastStatus: 204, lastError: null, leaseId: null });
    expect(row?.deliveredAt?.toISOString()).toBe(at(30).toISOString());
  });

  it('AC-10 permanent failures are dead at once: blocked destination, unreadable secret, oversize body', async () => {
    await oneRow();
    const blocked = new FakeTransport();
    blocked.outcome = { ok: false, code: 'blocked_destination' };
    expect(await send(blocked, at(30))).toMatchObject({ dead: 1 });
    expect((await deliveries())[0]).toMatchObject({ status: 'dead', lastError: 'blocked_destination', attempts: 1 });

    await db.owner.sql`delete from event_deliveries`;
    await emit('test.routed', {}, at(40));
    await deliver(at(41));
    const transport = new FakeTransport();
    expect(
      await deliverEventDeliveries(db.app, db.tenantId, {
        now: () => at(42),
        webhook: { transport, encryptionKey: OTHER_KEY },
      }),
    ).toMatchObject({ dead: 1 });
    expect((await deliveries())[0]).toMatchObject({ status: 'dead', lastError: 'secret_unreadable' });
    expect(transport.requests).toHaveLength(0);

    await db.owner.sql`delete from event_deliveries`;
    await emit('test.routed', { blob: 'x'.repeat(300 * 1024) }, at(50));
    await deliver(at(51));
    expect(await send(transport, at(52))).toMatchObject({ dead: 1 });
    expect((await deliveries())[0]).toMatchObject({ status: 'dead', lastError: 'payload_too_large' });
    expect(transport.requests).toHaveLength(0);
  });

  it('AC-11 two concurrent senders send each due row exactly once', async () => {
    await setWebhooks({ endpoints: [endpoint('e1')], inboxEmail: false });
    await issue('e1', at(0));
    for (let i = 0; i < 6; i++) await emit('test.routed', { i }, at(10));
    await deliver(at(20));
    const transport = new FakeTransport();
    const [one, two] = await Promise.all([send(transport, at(30)), send(transport, at(30))]);
    expect((one?.sent ?? 0) + (two?.sent ?? 0)).toBe(6);
    const ids = transport.requests.map((r) => r.headers['daifuku-delivery-id']);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it('AC-11 an expired lease is reclaimed and resent with the same id; the stale result is dropped', async () => {
    await oneRow();
    let release!: () => void;
    const stuck = new FakeTransport();
    stuck.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stuck.outcome = { ok: false, code: 'http_status', status: 503 };
    const captured = capture();
    const first = send(stuck, at(30), { log: captured.log });
    while (stuck.requests.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    const [claimed] = await deliveries();
    expect(claimed).toMatchObject({ status: 'sending', attempts: 1 });
    expect(claimed?.leaseUntil?.toISOString()).toBe(at(90).toISOString());
    const fresh = new FakeTransport();
    expect(await send(fresh, at(89))).toMatchObject({ sent: 0 });
    expect(await send(fresh, at(91))).toMatchObject({ sent: 1 });
    release();
    expect(await first).toMatchObject({ sent: 0, failed: 0 });
    const [row] = await deliveries();
    expect(row).toMatchObject({ status: 'delivered', attempts: 2 });
    expect(fresh.requests[0]?.headers['daifuku-delivery-id']).toBe(stuck.requests[0]?.headers['daifuku-delivery-id']);
    expect(captured.text()).toContain('lease was taken over');
  });

  it('AC-10 AC-11 a row whose lease expired at the 8th attempt is dead (lease_expired) without sending', async () => {
    await oneRow();
    await db.owner
      .sql`update event_deliveries set status = 'sending', attempts = 8, next_attempt_at = ${at(25).toISOString()}, lease_until = ${at(25).toISOString()}`;
    const transport = new FakeTransport();
    expect(await send(transport, at(30))).toMatchObject({ dead: 1 });
    expect((await deliveries())[0]).toMatchObject({ status: 'dead', lastError: 'lease_expired' });
    expect(transport.requests).toHaveLength(0);
  });

  it('AC-11 a process without the encryption key or mail transport claims nothing and counts the rows as skipped', async () => {
    await oneRow();
    const result = await deliverEventDeliveries(db.app, db.tenantId, { now: () => at(30) });
    expect(result).toEqual({ sent: 0, failed: 0, dead: 0, cancelled: 0, skipped: 1 });
    expect((await deliveries())[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('AC-12 rows of removed, disabled, changed or unsubscribed endpoints are cancelled without sending', async () => {
    const ids = ['removed', 'disabled', 'changed', 'unsub'];
    await setWebhooks({ endpoints: ids.map((id) => endpoint(id)), inboxEmail: false });
    for (const id of ids) await issue(id, at(0));
    await emit('test.routed', {}, at(10));
    await deliver(at(20));
    await setWebhooks({
      endpoints: [
        endpoint('disabled', { enabled: false }),
        endpoint('changed', { url: URL_B }),
        endpoint('unsub', { topics: ['test.other'] }),
      ],
      inboxEmail: false,
    });
    const transport = new FakeTransport();
    expect(await send(transport, at(30))).toMatchObject({ cancelled: 4, sent: 0 });
    expect(transport.requests).toHaveLength(0);
    const codes = Object.fromEntries((await deliveries()).map((r) => [r.target, [r.status, r.lastError]]));
    expect(codes).toEqual({
      removed: ['cancelled', 'endpoint_removed'],
      disabled: ['cancelled', 'endpoint_disabled'],
      changed: ['cancelled', 'endpoint_changed'],
      unsub: ['cancelled', 'topic_unsubscribed'],
    });
  });

  it('AC-17 AC-12 inbox mail goes to the current address with a fixed Message-ID, retries on SMTP failure, and is cancelled when off', async () => {
    await setWebhooks({ endpoints: [], inboxEmail: true });
    await db.run({ now: () => at(0) }, (ctx) => setInboxNotification(ctx, true, { mailConfigured: true }));
    const observe = (total: number, now: Date) =>
      db.run({ now: () => now }, (ctx) =>
        recordInboxObservation(ctx, {
          total,
          items: [
            {
              provider: 'test.todo',
              key: 'k',
              label: { ja: '承認待ち', en: 'To approve' },
              count: total,
              severity: 'warn',
            },
          ],
        }),
      );
    await observe(1, at(1));
    await observe(4, at(2));
    await deliver(at(3));
    const mail = new FakeMail();
    const deps = { now: () => at(4), mail: { transport: mail, webUrl: 'https://erp.example.com' } };
    mail.fail = true;
    expect(await deliverEventDeliveries(db.app, db.tenantId, deps)).toMatchObject({ failed: 1, skipped: 0 });
    expect((await deliveries())[0]).toMatchObject({ status: 'pending', lastError: 'mail_failed', attempts: 1 });
    mail.fail = false;
    expect(await deliverEventDeliveries(db.app, db.tenantId, { ...deps, now: () => at(100) })).toMatchObject({
      sent: 1,
    });
    const [row] = await deliveries();
    expect(mail.messages).toHaveLength(1);
    expect(mail.messages[0]).toMatchObject({ to: 'admin@example.com', messageId: `<${row?.id}@daifuku.events>` });
    expect(mail.messages[0]?.text).toContain('1 件から 4 件');
    expect(mail.messages[0]?.text).toContain('https://erp.example.com/inbox');
    expect(JSON.stringify(row)).not.toContain('admin@example.com');

    await observe(9, at(200));
    await deliver(at(201));
    await db.run({}, (ctx) => setInboxNotification(ctx, false, { mailConfigured: true }));
    expect(await deliverEventDeliveries(db.app, db.tenantId, { ...deps, now: () => at(202) })).toMatchObject({
      cancelled: 1,
    });
    expect((await deliveries()).at(-1)).toMatchObject({ status: 'cancelled', lastError: 'notification_off' });
  });

  it('AC-12 inbox mail to a user without membership is cancelled as recipient_inactive', async () => {
    const userId = newId();
    await db.owner.drizzle
      .insert(users)
      .values({ id: userId, tenantId: db.tenantId, email: 'gone@example.com', name: 'Gone' });
    await db.owner.drizzle
      .insert(companyMemberships)
      .values({ tenantId: db.tenantId, userId, companyId: db.companyId, roles: [] });
    await setWebhooks({ endpoints: [], inboxEmail: true });
    const asGone = { actor: { type: 'user' as const, id: userId }, roles: [], now: () => at(0) };
    await db.run(asGone, (ctx) => setInboxNotification(ctx, true, { mailConfigured: true }));
    await db.run(asGone, (ctx) => recordInboxObservation(ctx, { total: 0, items: [] }));
    await db.run({ ...asGone, now: () => at(1) }, (ctx) => recordInboxObservation(ctx, { total: 2, items: [] }));
    await deliver(at(2));
    await db.owner.drizzle
      .delete(companyMemberships)
      .where(and(eq(companyMemberships.userId, userId), eq(companyMemberships.companyId, db.companyId)));
    const mail = new FakeMail();
    expect(
      await deliverEventDeliveries(db.app, db.tenantId, {
        now: () => at(3),
        mail: { transport: mail, webUrl: 'https://erp.example.com' },
      }),
    ).toMatchObject({ cancelled: 1 });
    expect((await deliveries())[0]).toMatchObject({ status: 'cancelled', lastError: 'recipient_inactive' });
    expect(mail.messages).toHaveLength(0);
  });
});

describe('secrets and access (AC-14, AC-18, AC-22)', () => {
  it('AC-14 the secret is returned once and stored only as ciphertext; 409 without a key, 404 for an unknown endpoint', async () => {
    await setWebhooks({ endpoints: [endpoint('e1')], inboxEmail: false });
    const issued = await issue('e1', at(0));
    expect(issued.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const [row] = await db.owner.drizzle.select().from(webhookSecrets);
    expect(row?.secretCipher).not.toContain(issued.secret);
    expect(unseal(row?.secretCipher ?? '', KEY, `${db.tenantId}:${db.companyId}:e1:webhook-secret`)).toBe(
      issued.secret,
    );
    const audit = await db.owner.drizzle.select().from(auditLog).where(eq(auditLog.entity, 'webhook_secret'));
    expect(audit.at(-1)?.after).toEqual({ endpointId: 'e1', host: 'hooks.example.com' });
    await emit('test.routed', {}, at(5));
    await deliver(at(6));
    const view = await db.run({}, (ctx) => webhookEndpoints(ctx));
    expect(view.endpoints[0]?.secret.state).toBe('active');
    expect(view.endpoints[0]?.secret.issuedByName).toBe('Admin');
    for (const text of [
      JSON.stringify(view),
      JSON.stringify(await db.owner.drizzle.select().from(auditLog)),
      JSON.stringify(await db.owner.drizzle.select().from(outbox)),
      JSON.stringify(await deliveries()),
      JSON.stringify(await db.owner.drizzle.select().from(companies)),
    ])
      expect(text).not.toContain(issued.secret);
    await expect(issueWithoutKey('e1', at(1))).rejects.toMatchObject({ code: 'INVALID_STATE', httpStatus: 409 });
    await expect(issue('nope', at(1))).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
    await setWebhooks({ endpoints: [endpoint('e1', { url: URL_B })], inboxEmail: false });
    expect((await db.run({}, (ctx) => webhookEndpoints(ctx))).endpoints[0]?.secret.state).toBe('reissue_required');
  });

  it('AC-22 AC-18 kernel functions refuse non-user actors, non-admins and store-scoped admins', async () => {
    await setWebhooks({ endpoints: [endpoint('e1')], inboxEmail: true });
    const denied: Partial<ContextParams>[] = [
      { actor: { type: 'system', id: 'system' } },
      { actor: { type: 'relay', id: 'relay-1' } },
      { actor: { type: 'agent', id: 'agent-1', onBehalfOf: '' } },
      { roles: ['settings'] },
      { roles: [] },
      { accessScope: 'stores', storeIds: [newId()] },
    ];
    for (const params of denied) {
      await expect(db.run(params, (ctx) => listEventDeliveries(ctx))).rejects.toMatchObject({ httpStatus: 403 });
      await expect(db.run(params, (ctx) => retryEventDelivery(ctx, newId()))).rejects.toMatchObject({
        httpStatus: 403,
      });
      await expect(db.run(params, (ctx) => webhookEndpoints(ctx))).rejects.toMatchObject({ httpStatus: 403 });
      await expect(
        db.run(params, (ctx) => issueWebhookSecret(ctx, 'e1', { encryptionKey: KEY })),
      ).rejects.toMatchObject({ httpStatus: 403 });
    }
    for (const actor of [
      { type: 'system' as const, id: 'system' },
      { type: 'relay' as const, id: 'relay-1' },
      { type: 'agent' as const, id: 'agent-1', onBehalfOf: db.adminUserId },
    ]) {
      await expect(
        db.run({ actor }, (ctx) => getInboxNotification(ctx, { mailConfigured: true })),
      ).rejects.toMatchObject({
        httpStatus: 403,
      });
      await expect(
        db.run({ actor }, (ctx) => setInboxNotification(ctx, true, { mailConfigured: true })),
      ).rejects.toMatchObject({ httpStatus: 403 });
    }
  });

  it('AC-18 turning inbox mail on needs the company switch and a mail transport; turning it off always works', async () => {
    await setWebhooks({ endpoints: [], inboxEmail: false });
    expect(await db.run({}, (ctx) => getInboxNotification(ctx, { mailConfigured: true }))).toEqual({
      inboxEmail: false,
      available: false,
      reason: 'company_disabled',
    });
    await expect(db.run({}, (ctx) => setInboxNotification(ctx, true, { mailConfigured: true }))).rejects.toMatchObject({
      code: 'INVALID_STATE',
      details: { reason: 'company_disabled' },
    });
    await setWebhooks({ endpoints: [], inboxEmail: true });
    await expect(db.run({}, (ctx) => setInboxNotification(ctx, true, { mailConfigured: false }))).rejects.toMatchObject(
      { code: 'INVALID_STATE', details: { reason: 'mail_not_configured' } },
    );
    expect(await db.run({}, (ctx) => setInboxNotification(ctx, true, { mailConfigured: true }))).toEqual({
      inboxEmail: true,
      available: true,
    });
    await setWebhooks({ endpoints: [], inboxEmail: false });
    expect(await db.run({}, (ctx) => setInboxNotification(ctx, false, { mailConfigured: false }))).toMatchObject({
      inboxEmail: false,
    });
    expect(await db.owner.drizzle.select().from(inboxWatches)).toHaveLength(0);
  });
});

describe('administration (AC-19..AC-21)', () => {
  async function seedRows() {
    await setWebhooks({ endpoints: [endpoint('e1'), endpoint('e2')], inboxEmail: false });
    await issue('e1', at(0));
    await issue('e2', at(0));
    await emit('test.routed', { secret: 'payload-text' }, at(10));
    await emit('test.fail', {}, at(11));
    await deliver(at(12));
    const transport = new FakeTransport();
    transport.outcome = { ok: false, code: 'blocked_destination' };
    await send(transport, at(13), { limit: 1 });
    return transport;
  }

  it('AC-19 lists dead webhook and internal rows without bodies, URLs or secrets, with counts and a cursor', async () => {
    await seedRows();
    for (let attempt = 2; attempt <= 8; attempt++) await deliver(at(10 ** 5 * attempt));
    const list = await db.run({}, (ctx) => listEventDeliveries(ctx, { status: 'dead' }));
    expect(list.items.map((i) => i.kind).sort()).toEqual(['internal', 'webhook']);
    expect(list.counts).toMatchObject({ dead: 2, pending: 1 });
    const webhook = list.items.find((i) => i.kind === 'webhook');
    expect(webhook).toMatchObject({ status: 'dead', lastError: 'blocked_destination', target: { endpointId: 'e1' } });
    expect(webhook?.target.endpointLabel).toBe('Endpoint e1');
    const internal = list.items.find((i) => i.kind === 'internal');
    expect(internal).toMatchObject({ status: 'dead', attempts: 8, lastError: 'INTERNAL', topic: 'test.fail' });
    const text = JSON.stringify(list);
    for (const forbidden of ['payload-text', URL_A, 'hooks.example.com', 'whsec_', 'secret-ish'])
      expect(text).not.toContain(forbidden);
    const first = await db.run({}, (ctx) => listEventDeliveries(ctx, { status: 'dead', limit: 1 }));
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await db.run({}, (ctx) =>
      listEventDeliveries(ctx, { status: 'dead', limit: 1, before: first.nextCursor ?? undefined }),
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(second.nextCursor).toBeNull();
    const pending = await db.run({}, (ctx) => listEventDeliveries(ctx, { status: 'pending' }));
    expect(pending.items.map((i) => i.target.endpointId)).toEqual(['e2']);
    await expect(db.run({}, (ctx) => listEventDeliveries(ctx, { before: 'garbage' }))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('AC-20 resends a dead row with the same id; internal rows move to pending; other states 409, other companies 404', async () => {
    const transport = await seedRows();
    const [dead] = (await deliveries()).filter((r) => r.status === 'dead');
    const retried = await db.run({ now: () => at(20) }, (ctx) => retryEventDelivery(ctx, dead?.id ?? ''));
    expect(retried).toMatchObject({ id: dead?.id, status: 'pending', attempts: 0, lastError: 'blocked_destination' });
    const audit = await db.owner.drizzle.select().from(auditLog).where(eq(auditLog.entity, 'event_delivery'));
    expect(audit.at(-1)).toMatchObject({ recordId: dead?.id, op: 'retry' });
    await expect(db.run({}, (ctx) => retryEventDelivery(ctx, dead?.id ?? ''))).rejects.toMatchObject({
      code: 'INVALID_STATE',
      httpStatus: 409,
    });
    transport.outcome = { ok: true, status: 200 };
    await send(transport, at(21));
    expect(transport.requests.map((r) => r.headers['daifuku-delivery-id'])).toContain(dead?.id);
    await expect(
      db.run({ companyId: companyB }, (ctx) => retryEventDelivery(ctx, dead?.id ?? '')),
    ).rejects.toMatchObject({
      httpStatus: 404,
    });
    await expect(db.run({}, (ctx) => retryEventDelivery(ctx, newId()))).rejects.toMatchObject({ httpStatus: 404 });

    let now = 100;
    for (let attempt = 2; attempt <= 8; attempt++) await deliver(at((now += 10 ** 5)));
    const internal = await outboxRow('test.fail');
    expect(internal?.deadAt).not.toBeNull();
    const back = await db.run({ now: () => at(now + 1) }, (ctx) => retryEventDelivery(ctx, internal?.id ?? ''));
    expect(back).toMatchObject({ kind: 'internal', status: 'pending', attempts: 0, lastError: 'INTERNAL' });
    const pending = await db.run({}, (ctx) => listEventDeliveries(ctx, { status: 'pending' }));
    expect(pending.items.some((i) => i.id === internal?.id)).toBe(true);
    expect((await deliver(at(now + 2))).failed).toBe(1);
  });

  it('AC-21 purges delivered and cancelled rows after 30 days; dead and pending rows stay', async () => {
    await seedRows();
    const transport = new FakeTransport();
    await send(transport, at(14));
    const ids = (await deliveries()).map((r) => r.id);
    expect((await deliveries()).map((r) => r.status).sort()).toEqual(['dead', 'delivered']);
    expect(
      await withContext(db.app, systemParams(db.tenantId, null), (ctx) => purgeEventDeliveries(ctx, at(29 * 86400))),
    ).toBe(0);
    expect(
      await withContext(db.app, systemParams(db.tenantId, null), (ctx) => purgeEventDeliveries(ctx, at(31 * 86400))),
    ).toBe(1);
    const left = await deliveries();
    expect(left.map((r) => r.status)).toEqual(['dead']);
    expect(ids).toContain(left[0]?.id);
    expect(await db.owner.drizzle.select({ n: sql<number>`count(*)::int` }).from(outbox)).toEqual([{ n: 2 }]);
  });
});
