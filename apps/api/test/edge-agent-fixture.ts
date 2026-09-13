// Synthetic local child-process fixture. Never enable against a live ERP database.
import { createInterface } from 'node:readline';
import { isUuid, newId, repo } from '@daifuku/kernel';
import { EdgeJob } from '@daifuku/mod-edge-integration';
import { freshDb } from '@daifuku/kernel/testing';
import { WorkforceSite } from '@daifuku/mod-workforce';
import { buildServer } from '../src/server.ts';
class FixtureFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super('Synthetic request failed');
  }
}

function assertTestEnvironment() {
  if (process.env.DAIFUKU_EDGE_TEST_FIXTURE !== '1') throw new Error('Explicit fixture permission required');
  for (const key of ['TEST_DATABASE_URL_OWNER', 'TEST_DATABASE_URL']) {
    const url = new URL(process.env[key] ?? '');
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !/^\/daifuku_[a-z0-9_]*test[a-z0-9_]*$/.test(url.pathname)
    )
      throw new Error('Dedicated loopback test database required');
  }
}
async function main() {
  assertTestEnvironment();
  const db = await freshDb();
  const app = await buildServer({
    owner: db.owner,
    app: db.app,
    jwtSecret: 'synthetic-edge-fixture-secret',
    identity: {
      encryptionKey: Buffer.alloc(32, 8).toString('base64'),
      webUrl: 'https://erp.example.com',
      providers: [],
    },
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const token = app.jwt.sign({ sub: db.adminUserId, tenantId: db.tenantId, sessionVersion: 1 });
  const post = async (url: string, payload: Record<string, unknown>) => {
    const response = await app.inject({ method: 'POST', url, payload, headers: { authorization: 'Bearer ' + token } });
    if (response.statusCode !== 200) {
      const error = response.json<{ error?: { code?: string } }>();
      throw new FixtureFailure(response.statusCode, error.error?.code ?? 'UNKNOWN');
    }
    return response.json() as Record<string, unknown>;
  };
  const site = await db.run({}, (ctx) =>
    repo(ctx, WorkforceSite).create({ code: 'AGENT-TEST', name: 'Synthetic LAN site' }),
  );
  const gateway = await post('/actions/edge.create_gateway', {
    siteId: site.id,
    code: 'AGENT-TEST',
    name: 'Synthetic gateway',
  });
  const device = await post('/actions/edge.register_device', {
    gatewayId: gateway.id,
    localDeviceId: 'test-printer',
    name: 'Synthetic printer',
    driver: 'simulator',
  });
  const issue = async () => {
    const step = await post('/auth/step-up', { currentPassword: 'password' });
    return post('/edge/pairings', {
      gatewayId: gateway.id,
      expectedVersion: gateway.version,
      stepUpToken: step.stepUpToken,
    });
  };
  const enqueue = (
    request: unknown = {
      kind: 'print.text',
      payload: { text: 'Synthetic end-to-end receipt', title: 'Test', copies: 1 },
    },
  ) =>
    post('/actions/edge.enqueue', {
      deviceId: device.id,
      idempotencyKey: newId(),
      request,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
  const pair = await issue(),
    job = await enqueue();
  const write = (data: Record<string, unknown>) => process.stdout.write(JSON.stringify(data) + '\n');
  write({
    type: 'ready',
    address,
    pairingToken: pair.pairingToken,
    deviceId: device.id,
    gatewayId: gateway.id,
    jobId: job.id,
    localDeviceId: 'test-printer',
  });
  const input = createInterface({ input: process.stdin });
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    input.close();
    await app.close();
    await db.close();
  };
  const command = async (raw: string) => {
    const message = JSON.parse(raw) as { id?: string; operation: string; request?: unknown; jobId?: string };
    let result: unknown;
    try {
      if (message.operation === 'enqueue') result = await enqueue(message.request);
      else if (['board', 'events'].includes(message.operation))
        result = await post('/actions/edge.board', { gatewayId: gateway.id });
      else if (message.operation === 'pairing') result = await issue();
      else if (message.operation === 'expire_claim') {
        if (!message.jobId || !isUuid(message.jobId) || typeof gateway.id !== 'string')
          throw new Error('Invalid fixture job');
        const rows = await db.owner
          .sql`update edge_job set lease_until = now() - interval '120 seconds' where id = ${message.jobId} and tenant_id = ${db.tenantId} and company_id = ${db.companyId} and gateway_id = ${gateway.id} and state = 'claimed' and started_at is null returning id`;
        result = { expired: rows.length === 1 };
      } else if (message.operation === 'resolve') {
        if (!message.jobId || !isUuid(message.jobId)) throw new Error('Invalid fixture job');
        const jobId = message.jobId,
          job = await db.run({}, (ctx) => repo(ctx, EdgeJob).get(jobId));
        if (job.gatewayId !== gateway.id) throw new Error('Fixture job outside gateway');
        result = await post('/actions/edge.resolve', {
          jobId,
          expectedVersion: job.version,
          reason: 'Synthetic physical inspection',
          evidence: 'Fixture confirms no remaining output',
          resolution: 'failed',
        });
      } else if (message.operation === 'revoke') {
        const step = await post('/auth/step-up', { currentPassword: 'password' });
        result = await post('/edge/credentials/revoke', {
          gatewayId: gateway.id,
          expectedVersion: gateway.version,
          stepUpToken: step.stepUpToken,
          reason: 'Synthetic revocation test',
        });
      } else if (message.operation === 'stop') {
        await stop();
        result = { ok: true };
      } else throw new Error('Unknown fixture operation');
      write({ type: 'result', id: message.id ?? null, operation: message.operation, result });
    } catch (error) {
      write({
        type: 'error',
        id: message.id ?? null,
        operation: ['enqueue', 'board', 'events', 'pairing', 'expire_claim', 'resolve', 'revoke', 'stop'].includes(
          message.operation,
        )
          ? message.operation
          : 'unknown',
        status: error instanceof FixtureFailure ? error.status : null,
        code: error instanceof FixtureFailure ? error.code : 'FIXTURE_OPERATION',
      });
    }
  };
  let pending = Promise.resolve();
  input.on('line', (line) => {
    pending = pending
      .then(() => command(line))
      .catch(() => {
        write({ type: 'error', message: 'Synthetic fixture operation failed' });
      });
  });
  input.on('close', () => {
    if (!closing) void pending.finally(stop);
  });
  process.once('SIGINT', () => {
    void stop();
  });
  process.once('SIGTERM', () => {
    void stop();
  });
}
main().catch(() => {
  process.stderr.write('Synthetic edge fixture could not start.\n');
  process.exit(1);
});
