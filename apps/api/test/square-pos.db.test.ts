import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { repo, type InsertInput } from '@daifuku/kernel';
import { Account, openFiscalYear } from '@daifuku/mod-accounting';
import { PosLocation, PosInbox } from '@daifuku/mod-pos-integration';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.ts';
import type { SquareConnection } from '../src/adapters/square-pos.ts';
let db: TestDb;
let app: FastifyInstance;
let cfg: SquareConnection;
const body = (id: string, merchantId = 'MERCHANT', amount = 1000) =>
  JSON.stringify({
    event_id: 'E-' + id,
    merchant_id: merchantId,
    type: 'payment.updated',
    created_at: '2026-08-31T03:00:00Z',
    data: {
      object: {
        payment: {
          id,
          location_id: 'STORE',
          status: 'COMPLETED',
          created_at: '2026-08-31T03:00:00Z',
          total_money: { amount, currency: 'JPY' },
          buyer_email_address: 'must-not-persist@example.invalid',
        },
      },
    },
  });
const signed = (raw: string) => ({
  'content-type': 'application/json',
  'x-square-hmacsha256-signature': createHmac('sha256', cfg.signatureKey)
    .update(cfg.notificationUrl + raw)
    .digest('base64'),
});
const post = (raw: string, key = 'main') =>
  app.inject({ method: 'POST', url: '/webhooks/square/' + key, headers: signed(raw), payload: raw });
// mappingKey is derived by the trusted before_validate hook; do not supply a server-owned field.
beforeAll(async () => {
  db = await freshDb();
  const locationId = await db.run({}, async (ctx) => {
    await openFiscalYear(ctx, { startDate: '2026-01-01' });
    const asset = await repo(ctx, Account).create({ code: 'POS-A', name: 'Square未収', type: 'asset' });
    const liability = await repo(ctx, Account).create({ code: 'POS-L', name: '未分類売上', type: 'liability' });
    return (
      await repo(ctx, PosLocation).create({
        code: 'SQUARE',
        name: '本店',
        merchantId: 'MERCHANT',
        externalLocationId: 'STORE',
        settlementAccountId: asset.id,
        suspenseAccountId: liability.id,
      } as InsertInput<typeof PosLocation>)
    ).id;
  });
  cfg = {
    key: 'main',
    tenantId: db.tenantId,
    companyId: db.companyId,
    userId: db.adminUserId,
    locationId,
    merchantId: 'MERCHANT',
    externalLocationId: 'STORE',
    notificationUrl: 'https://erp.example.invalid/webhooks/square/main',
    signatureKey: 'synthetic-test-signature-key-32chars',
  };
  app = await buildServer({
    app: db.app,
    owner: db.owner,
    jwtSecret: 'synthetic-pos-test-secret',
    squarePosConnections: [cfg],
  });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});
describe('signed Square API delivery', () => {
  it('accepts a verified event without JWT, persists safe evidence and returns one accounting source on replay', async () => {
    const raw = body('route-payment');
    const first = await post(raw);
    expect(first.statusCode, first.body).toBe(200);
    const replay = await post(raw);
    expect(replay.json().transactionId).toBe(first.json().transactionId);
    await db.run({}, async (ctx) => {
      const inbox = (await repo(ctx, PosInbox).list()).items;
      expect(inbox).toHaveLength(1);
      expect(JSON.stringify(inbox)).not.toContain('must-not-persist');
    });
  });
  it('rejects unsigned, wrong merchant, unconfigured, malformed and oversized deliveries before accepting them', async () => {
    const raw = body('invalid');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/webhooks/square/main',
          headers: { 'content-type': 'application/json' },
          payload: raw,
        })
      ).statusCode,
    ).toBe(403);
    expect((await post(body('foreign', 'FOREIGN'))).statusCode).toBe(403);
    expect((await post(raw, 'missing')).statusCode).toBe(503);
    expect((await post('{')).statusCode).toBe(400);
    expect((await post(' '.repeat(1048577))).statusCode).toBe(413);
    await db.run({}, async (ctx) => {
      expect((await repo(ctx, PosInbox).list()).total).toBe(1);
    });
  });
  it('returns an explicit blocked durable state and refuses inactive integration identities', async () => {
    const invalidMoney = await post(body('zero', 'MERCHANT', 0));
    expect(invalidMoney.statusCode, invalidMoney.body).toBe(202);
    expect(invalidMoney.json().status).toBe('blocked');
    await db.owner.sql`update users set active = false where id=${db.adminUserId}`;
    expect((await post(body('revoked'))).statusCode).toBe(403);
    await db.owner.sql`update users set active = true where id=${db.adminUserId}`;
  });
});
