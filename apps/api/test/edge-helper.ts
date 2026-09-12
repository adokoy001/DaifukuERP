import { expect } from 'vitest';
import { newId, newRelaySecret, repo } from '@daifuku/kernel';
import { WorkforceSite } from '@daifuku/mod-workforce';
import type { TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

export function edgeFixture(db: TestDb, app: FastifyInstance, token: string) {
  const secrets: string[] = [];
  const post = (url: string, payload: Record<string, unknown> = {}, auth = token): Promise<LightMyRequestResponse> => app.inject({ method: 'POST', url, payload, headers: { authorization: 'Bearer ' + auth } });
  const session = (secret: string): Promise<LightMyRequestResponse> => app.inject({ method: 'GET', url: '/relay/session', headers: { authorization: 'Bearer ' + secret } });
  const step = async (auth = token) => {
    const result = await post('/auth/step-up', { currentPassword: 'password' }, auth);
    expect(result.statusCode, result.body).toBe(200);
    return result.json<{ stepUpToken: string }>().stepUpToken;
  };
  const fixture = async () => {
    const site = await db.run({}, (ctx) => repo(ctx, WorkforceSite).create({ code: newId(), name: 'Synthetic site' }));
    const g = await post('/actions/edge.create_gateway', { siteId: site.id, code: newId(), name: 'Gateway' }); expect(g.statusCode, g.body).toBe(200);
    const gateway = g.json<{ id: string; version: number }>();
    const d = await post('/actions/edge.register_device', { gatewayId: gateway.id, localDeviceId: 'printer', name: 'Test device', driver: 'simulator' }); expect(d.statusCode, d.body).toBe(200);
    return { site, gateway, device: d.json<{ id: string }>() };
  };
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const issue = async (f: Fixture, auth = token) => {
    const response = await post('/edge/pairings', { gatewayId: f.gateway.id, expectedVersion: f.gateway.version, stepUpToken: await step(auth) }, auth);
    expect(response.statusCode, response.body).toBe(200);
    const pairingToken = response.json<{ pairingToken: string }>().pairingToken; secrets.push(pairingToken); return pairingToken;
  };
  const pair = async (f: Fixture) => {
    const pairingToken = await issue(f), credentialSecret = newRelaySecret(); secrets.push(credentialSecret);
    const response = await post('/relay/pair', { pairingToken, credentialSecret, protocolVersion: 1, agentVersion: 'test-1' }, ''); expect(response.statusCode, response.body).toBe(200);
    return credentialSecret;
  };
  const enqueue = async (f: Fixture) => {
    const response = await post('/actions/edge.enqueue', { deviceId: f.device.id, idempotencyKey: newId(), request: { kind: 'print.text', payload: { text: 'Receipt', title: 'Test', copies: 1 } }, expiresAt: new Date(Date.now() + 3600000).toISOString() });
    expect(response.statusCode, response.body).toBe(200); return response.json<{ id: string }>();
  };
  return { post, session, step, fixture, issue, pair, enqueue, secrets };
}
