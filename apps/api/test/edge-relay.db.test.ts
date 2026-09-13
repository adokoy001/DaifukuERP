import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { newId, newRelaySecret, relayHash, users, hashPassword } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.ts';
import { edgeFixture } from './edge-helper.ts';
let db: TestDb, app: FastifyInstance, address: string, token: string, h: ReturnType<typeof edgeFixture>;
const logs: string[] = [];
beforeAll(async () => {
  db = await freshDb();
  app = await buildServer({
    owner: db.owner,
    app: db.app,
    jwtSecret: 'synthetic-edge-jwt-secret',
    identity: {
      encryptionKey: Buffer.alloc(32, 8).toString('base64'),
      webUrl: 'https://erp.example.com',
      providers: [],
    },
    logger: {
      stream: {
        write: (line: string) => {
          logs.push(line);
        },
      },
    },
  });
  address = await app.listen({ host: '127.0.0.1', port: 0 });
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'admin@example.com', password: 'password' },
  });
  expect(login.statusCode, login.body).toBe(200);
  token = login.json<{ token: string }>().token;
  h = edgeFixture(db, app, token);
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});
describe('relay authentication and real websocket transport', () => {
  it('consumes pairing once, stores only a hash and recovers a lost response with the pre-saved credential', async () => {
    const f = await h.fixture(),
      pairingToken = await h.issue(f),
      credentialSecret = newRelaySecret();
    h.secrets.push(credentialSecret);
    const input = { pairingToken, credentialSecret, protocolVersion: 1, agentVersion: 'test-1' };
    const results = await Promise.all([h.post('/relay/pair', input, ''), h.post('/relay/pair', input, '')]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
    const recovered = await h.session(credentialSecret);
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect(recovered.json()).toMatchObject({
      gatewayId: f.gateway.id,
      companyId: db.companyId,
      siteId: f.site.id,
      credentialVersion: 1,
    });
    expect(await db.owner.sql`select secret_hash from relay_credentials where gateway_id = ${f.gateway.id}`).toEqual([
      { secret_hash: relayHash(credentialSecret) },
    ]);
    expect((await h.post('/relay/pair', input, '')).statusCode).toBe(401);
  });
  it('rotates without response-dependent storage and isolates relay credentials from human APIs', async () => {
    const f = await h.fixture(),
      secret = await h.pair(f),
      next = newRelaySecret();
    h.secrets.push(next);
    const rotation = await h.post(
      '/relay/credentials/rotate',
      { rotationId: newId(), newCredentialSecret: next },
      secret,
    );
    expect(rotation.statusCode, rotation.body).toBe(200);
    expect((await h.session(secret)).statusCode).toBe(401);
    expect((await h.session(next)).json()).toMatchObject({ credentialVersion: 2 });
    expect((await h.session(token)).statusCode).toBe(401);
    expect((await h.post('/actions/edge.enqueue', {}, next)).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: 'Bearer ' + next } })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/relay/session?token=' + next,
          headers: { authorization: 'Bearer ' + next },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/relay/session',
          headers: { authorization: 'Bearer ' + next, 'x-company-id': db.companyId },
        })
      ).statusCode,
    ).toBe(401);
  });
  it('requires an active binding, expected version and a one-use step-up', async () => {
    const f = await h.fixture(),
      other = await h.fixture(),
      stepUpToken = await h.step();
    expect(
      (await h.post('/edge/pairings', { gatewayId: f.gateway.id, expectedVersion: 99, stepUpToken })).statusCode,
    ).toBe(409);
    const good = await h.post('/edge/pairings', {
      gatewayId: f.gateway.id,
      expectedVersion: f.gateway.version,
      stepUpToken,
    });
    expect(good.statusCode, good.body).toBe(200);
    expect(
      (
        await h.post('/edge/pairings', {
          gatewayId: other.gateway.id,
          expectedVersion: other.gateway.version,
          stepUpToken,
        })
      ).statusCode,
    ).toBe(401);
    const pairingToken = good.json<{ pairingToken: string }>().pairingToken;
    const disabled = await h.post('/actions/edge.set_gateway_active', {
      gatewayId: f.gateway.id,
      expectedVersion: f.gateway.version,
      active: false,
      reason: 'No longer used',
    });
    expect(disabled.statusCode).toBe(200);
    expect(
      (
        await h.post(
          '/relay/pair',
          { pairingToken, credentialSecret: newRelaySecret(), protocolVersion: 1, agentVersion: 'test' },
          '',
        )
      ).statusCode,
    ).toBe(409);
  });
  it('rechecks the issuing operator membership when a pending pairing is consumed', async () => {
    const f = await h.fixture(),
      id = newId();
    await db.owner.drizzle.insert(users).values({
      id,
      tenantId: db.tenantId,
      email: id + '@example.com',
      name: 'Device operator',
      passwordHash: hashPassword('password'),
      defaultCompanyId: db.companyId,
    });
    const assigned = await app.inject({
      method: 'PUT',
      url: `/admin/users/${id}/companies/${db.companyId}`,
      headers: { authorization: 'Bearer ' + token },
      payload: {
        expectedVersion: 0,
        roles: ['edge_manager'],
        accessScope: 'sites',
        siteIds: [f.site.id],
        storeIds: [],
      },
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
    const login = await h.post('/auth/login', { email: id + '@example.com', password: 'password' }, '');
    const own = login.json<{ token: string }>().token;
    const pending = await h.issue(f, own);
    await db.owner.sql`update user_company_memberships set roles = '["viewer"]'::jsonb where user_id = ${id}`;
    expect(
      (
        await h.post(
          '/relay/pair',
          { pairingToken: pending, credentialSecret: newRelaySecret(), protocolVersion: 1, agentVersion: 'test' },
          '',
        )
      ).statusCode,
    ).toBe(401);
  });
  it('sends notification-only frames from DB hints and closes an existing connection after revocation', async () => {
    const f = await h.fixture(),
      secret = await h.pair(f);
    const socket = new WebSocket(address.replace('http:', 'ws:') + '/relay/notifications', {
      headers: { authorization: 'Bearer ' + secret },
    });
    await once(socket, 'open');
    const hint = once(socket, 'message');
    await h.enqueue(f);
    const [data] = await hint;
    expect(JSON.parse(String(data))).toEqual({ type: 'jobs_available', protocolVersion: 1 });
    const closed = once(socket, 'close');
    const revoked = await h.post('/edge/credentials/revoke', {
      gatewayId: f.gateway.id,
      expectedVersion: f.gateway.version,
      stepUpToken: await h.step(),
      reason: 'Lost relay machine',
    });
    expect(revoked.statusCode, revoked.body).toBe(200);
    const [code] = await closed;
    expect(code).toBe(1008);
    expect((await h.session(secret)).statusCode).toBe(401);
  }, 20000);
  it('polls after lost notifications and never grants a second start over HTTP', async () => {
    const f = await h.fixture(),
      secret = await h.pair(f),
      queued = await h.enqueue(f);
    const claim = await h.post('/relay/jobs/claim', {}, secret);
    expect(claim.statusCode, claim.body).toBe(200);
    const job = claim.json<{ job: { id: string; leaseToken: string; attempt: number } }>().job;
    expect(job.id).toBe(queued.id);
    h.secrets.push(job.leaseToken);
    const input = { jobId: job.id, leaseToken: job.leaseToken, attempt: job.attempt };
    expect((await h.post('/relay/jobs/start', input, secret)).json()).toMatchObject({ startGranted: true });
    expect((await h.post('/relay/jobs/start', input, secret)).json()).toMatchObject({ startGranted: false });
    expect(
      (
        await h.post('/relay/jobs/complete', { ...input, result: { state: 'succeeded', code: 'simulated' } }, secret)
      ).json(),
    ).toMatchObject({ accepted: true, state: 'succeeded' });
    const event = await h.post(
      '/relay/events',
      {
        eventId: newId(),
        deviceId: f.device.id,
        localDeviceId: 'printer',
        observedAt: new Date().toISOString(),
        status: 'online',
        code: 'ready',
      },
      secret,
    );
    expect(event.statusCode, event.body).toBe(200);
    const board = await h.post('/actions/edge.board', { gatewayId: f.gateway.id });
    expect(board.statusCode, board.body).toBe(200);
    expect(board.json<{ events: { code: string }[] }>().events).toMatchObject([{ code: 'ready' }]);
    expect(board.body).not.toContain(job.leaseToken);
    expect(board.body).not.toContain('leaseHash');
    expect(board.body).not.toContain('Receipt');
  });
  it('keeps raw credentials out of logs and audit and returns a detail-free readiness status', async () => {
    const audit = JSON.stringify(
      await db.owner.sql`select before, after from audit_log where entity like 'edge_%' or entity = 'relay'`,
    );
    for (const secret of h.secrets) {
      expect(audit).not.toContain(secret);
      expect(logs.join('')).not.toContain(secret);
    }
    const readiness = await app.inject('/ready');
    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toEqual({ ready: false });
  });
});
