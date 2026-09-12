import { repo, runAction } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { JournalEntry } from '@daifuku/mod-accounting';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { modules } from '../src/modules.ts';
import { buildServer } from '../src/server.ts';

let db: TestDb;
let app: FastifyInstance;
let token: string;
beforeAll(async () => {
  db = await freshDb();
  await db.run({}, async (ctx) => { for (const module of modules) await module.seed?.(ctx); });
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'document-options-test', logger: false });
  await app.ready();
  token = app.jwt.sign({ sub: db.adminUserId, tenantId: db.tenantId, sessionVersion: 1 });
});
afterAll(async () => { await app.close(); await db.close(); });
const act = (name: string, input: unknown) => db.run({}, (ctx) => runAction(ctx, name, input)) as Promise<Record<string, unknown>>;
async function invoice() {
  const customer = await act('partner.create', { name: 'Document options customer', isCustomer: true });
  return act('sales_invoice.create', { partnerId: customer.id, date: '2026-09-12', lines: { sales_invoice_line: [{ description: 'Service', quantity: '1', unitPrice: '9000', taxCategory: 'standard' }] } });
}
const post = (url: string, payload: unknown, method: 'POST' | 'DELETE' = 'POST') => app.inject({ method, url, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, payload: JSON.stringify(payload) });

describe('foundation-refresh lifecycle transport', () => {
  it('preserves the explicit correction date through REST into both invoice history and reversal posting', async () => {
    const draft = await invoice();
    const submitted = await post(`/api/sales_invoice/${String(draft.id)}/submit`, { expectedVersion: draft.version });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const row = submitted.json<Record<string, unknown>>();
    const cancelled = await post(`/api/sales_invoice/${String(row.id)}/cancel`, { expectedVersion: row.version, correctionDate: '2026-09-13' });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json()).toMatchObject({ docstatus: 2, cancelledDate: '2026-09-13' });
    const reversed = await db.run({}, (ctx) => repo(ctx, JournalEntry).list({ where: { reversalOf: String(row.journalEntryId) } }));
    expect(reversed.items).toHaveLength(1);
    expect(reversed.items[0]?.date).toBe('2026-09-13');
  });
  it('keeps a draft when DELETE carries a stale version', async () => {
    const draft = await invoice();
    await act('sales_invoice.update', { id: draft.id, patch: { note: 'Saved in another window' }, expectedVersion: draft.version });
    const removed = await post(`/api/sales_invoice/${String(draft.id)}`, { expectedVersion: draft.version }, 'DELETE');
    expect(removed.statusCode, removed.body).toBe(409);
    expect(await act('sales_invoice.get', { id: draft.id })).toMatchObject({ note: 'Saved in another window' });
  });
});
