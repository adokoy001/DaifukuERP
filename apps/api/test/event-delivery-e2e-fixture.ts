// Browser fixture of docs/specs/event-delivery.md (AC-25..AC-27): inside an explicitly prepared loopback E2E database
// and one synthetic company the spec created, registers a webhook endpoint pointing at a receiver in this process that
// always answers 500, issues its signing secret with a fixture-only encryption key, emits one event and runs the real
// kernel delivery path 8 times with the clock advanced, so the browser sees a genuine `dead` delivery. It also adds a
// store-scoped admin of that company (a membership the admin API refuses, AC-27). The browser-test API keeps the worker
// off and has no encryption key. Prints {"deadId", "scopedAdminEmail"}. Never resets anything.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  companyMemberships,
  connect,
  deliverEventDeliveries,
  deliverPending,
  hashPassword,
  integrationWebhooksSchema,
  INTEGRATION_WEBHOOKS_KEY,
  issueWebhookSecret,
  newId,
  setSetting,
  systemParams,
  users,
  withContext,
} from '@daifuku/kernel';
import { webhookTransport } from '../src/events/webhook-transport.ts';

function fail(): never {
  throw new Error(
    'Event delivery E2E requires an explicitly prepared loopback fixture database and a synthetic company.',
  );
}

const FIXTURE_KEY = Buffer.alloc(32, 11).toString('base64');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function args(): { tenantId: string; userId: string; companyId: string; runId: string; password: string } {
  const [tenantId = '', userId = '', companyId = '', runId = '', password = ''] = process.argv.slice(2);
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.E2E_PREPARE !== '1' ||
    !UUID.test(tenantId) ||
    !UUID.test(userId) ||
    !UUID.test(companyId) ||
    !/^[a-f0-9]{12}$/.test(runId) ||
    !password
  )
    fail();
  return { tenantId, userId, companyId, runId, password };
}

async function main() {
  const { tenantId, userId, companyId, runId, password } = args();
  const ownerUrl = new URL(process.env.DATABASE_URL_OWNER ?? 'invalid');
  const appUrl = new URL(process.env.DATABASE_URL ?? 'invalid');
  for (const url of [ownerUrl, appUrl])
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !/^\/(daifuku_ci_e2e|daifuku_e2e_test(?:_[a-z0-9]+)?)$/.test(url.pathname) ||
      appUrl.username !== 'daifuku_app'
    )
      fail();
  const receiver = createServer((req, res) => {
    req.resume();
    req.on('end', () => res.writeHead(500).end('synthetic failure'));
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
  const owner = connect(ownerUrl.href, { max: 1 });
  const app = connect(appUrl.href, { max: 2 });
  const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
  try {
    const start = Date.now();
    const at = (seconds: number) => () => new Date(start + seconds * 1000);
    const admin = { tenantId, companyId, actor: { type: 'user' as const, id: userId }, roles: ['admin'], log };
    await withContext(app, { ...admin, now: at(0) }, (ctx) =>
      setSetting(ctx, INTEGRATION_WEBHOOKS_KEY, integrationWebhooksSchema, {
        endpoints: [{ id: 'erp', label: `会計連携（試験 ${runId}）`, url: `${base}/hook`, topics: ['e2e.*'] }],
        inboxEmail: true,
      }),
    );
    await withContext(app, { ...admin, now: at(0) }, (ctx) =>
      issueWebhookSecret(ctx, 'erp', { encryptionKey: FIXTURE_KEY, expectedUrl: `${base}/hook` }),
    );
    await withContext(app, { ...admin, now: at(1) }, (ctx) => ctx.emit('e2e.dead_letter', { runId }));
    const transport = webhookTransport({ allowLoopback: true, timeoutMs: 5000 });
    let deadId = '';
    for (let attempt = 0; attempt < 8; attempt++) {
      const now = at(2 + attempt * 61 * 60);
      await withContext(app, systemParams(tenantId, companyId, { now, log }), (ctx) => deliverPending(ctx));
      await deliverEventDeliveries(app, tenantId, { now, log, webhook: { transport, encryptionKey: FIXTURE_KEY } });
    }
    const rows = await owner.sql<{ id: string; status: string }[]>`
      select id, status from event_deliveries where company_id = ${companyId} and topic = 'e2e.dead_letter'`;
    deadId = rows.find((row) => row.status === 'dead')?.id ?? '';
    if (!deadId) throw new Error('the synthetic delivery did not reach dead');
    // AC-27: a store-scoped admin (the admin API refuses this membership; it exists only through direct data).
    const scopedId = newId();
    const scopedAdminEmail = `event-scoped-admin-${runId}@example.invalid`;
    await owner.drizzle.insert(users).values({
      id: scopedId,
      tenantId,
      email: scopedAdminEmail,
      name: `店舗限定の管理者 ${runId}`,
      passwordHash: await hashPassword(password),
      defaultCompanyId: companyId,
    });
    await owner.drizzle.insert(companyMemberships).values({
      tenantId,
      companyId,
      userId: scopedId,
      roles: ['admin'],
      accessScope: 'stores',
      storeIds: [newId()],
    });
    process.stdout.write(JSON.stringify({ deadId, scopedAdminEmail }));
  } finally {
    receiver.close();
    await app.close();
    await owner.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'event delivery fixture failed');
  process.exitCode = 1;
});
