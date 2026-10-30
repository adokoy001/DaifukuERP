// docs/specs/evidence-search.md over REST with every module registered: POST /actions/attachment.evidence_search and
// attachment.history answer 200 / 400 / 403; evidence linked to a purchase invoice (and to one of its lines) shows the
// document's number to roles that may read it and `readable: false` to sales, which still gets the evidence row (AC-5,
// AC-6, the current visibility of evidence rows); a deleted draft target turns unreadable; an older version listed by
// the history downloads through GET /api/attachments/:id/download (AC-10).
import {
  companyMemberships,
  configureStorage,
  hashPassword,
  LocalStorage,
  newId,
  runAction,
  users,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { uploadAttachment, type AttachmentRow, type EvidenceItem, type HistoryItem } from '@daifuku/mod-attachments';
import type { FastifyInstance } from 'fastify';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { modules } from '../src/modules.ts';
import { buildServer } from '../src/server.ts';

let db: TestDb;
let app: FastifyInstance;
const tokens: Record<string, string> = {};
let seq = 0;

const act = (name: string, input: unknown) =>
  db.run({}, (ctx) => runAction(ctx, name, input)) as Promise<Record<string, unknown> & { id: string }>;

async function post(
  action: string,
  body: unknown,
  role = 'admin',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST',
    url: `/actions/${action}`,
    headers: { authorization: `Bearer ${tokens[role]}`, 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

async function addUser(role: string, roles: string[]): Promise<void> {
  const id = newId();
  await db.owner.drizzle.insert(users).values({
    id,
    tenantId: db.tenantId,
    email: `evidence-${role}@example.com`,
    name: `Evidence ${role}`,
    passwordHash: await hashPassword(`${role}-pw`),
    roles,
    defaultCompanyId: db.companyId,
  });
  await db.owner.drizzle
    .insert(companyMemberships)
    .values({ tenantId: db.tenantId, userId: id, companyId: db.companyId, roles });
  tokens[role] = app.jwt.sign({ sub: id, tenantId: db.tenantId, sessionVersion: 1 });
}

function upload(fields: Record<string, string>): Promise<AttachmentRow> {
  seq += 1;
  return db.run({}, (ctx) =>
    uploadAttachment(ctx, {
      data: new TextEncoder().encode(`api evidence #${seq} ${newId()}`),
      filename: `api-evidence-${seq}.pdf`,
      contentType: 'application/pdf',
      fields,
    }),
  );
}

async function draftBill(supplierId: string, expenseId: string, unitPrice: string) {
  return act('purchase_invoice.create', {
    partnerId: supplierId,
    date: '2026-10-04',
    lines: {
      purchase_invoice_line: [
        { accountId: expenseId, description: 'Evidence goods', quantity: '1', unitPrice, taxCategory: 'standard' },
      ],
    },
  });
}

let supplierId: string;
let expenseId: string;

beforeAll(async () => {
  configureStorage(new LocalStorage(await mkdtemp(join(tmpdir(), 'daifuku-evidence-api-'))));
  db = await freshDb();
  await db.run({}, async (ctx) => {
    for (const module of modules) await module.seed?.(ctx);
  });
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'evidence-test', logger: false });
  await app.ready();
  tokens.admin = app.jwt.sign({ sub: db.adminUserId, tenantId: db.tenantId, sessionVersion: 1 });
  await addUser('accounting', ['accounting']);
  await addUser('sales', ['sales']);
  await addUser('viewer', ['viewer']);
  await addUser('nobody', []);
  supplierId = (await act('partner.create', { name: 'Evidence supplier', isSupplier: true })).id;
  const expense = (await act('account.list', { where: { type: 'expense' }, limit: 1 })) as unknown as {
    items: { id: string }[];
  };
  expenseId = expense.items[0]?.id as string;
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe('attachment.evidence_search over REST (docs/specs/evidence-search.md)', () => {
  it('AC-5 AC-6 a posted purchase invoice and its line: number and status for readers, readable: false for sales, which still sees the rows', async () => {
    const draft = await draftBill(supplierId, expenseId, '1200');
    const bill = await act('purchase_invoice.submit', { id: draft.id });
    const lines = (await act('purchase_invoice_line.list', { where: { invoiceId: bill.id } })) as unknown as {
      items: { id: string }[];
    };
    const lineId = lines.items[0]?.id as string;
    const common = { kind: 'invoice_received', txnDate: '2026-10-04', amount: '1320', partnerId: supplierId };
    const onBill = await upload({ ...common, linkedEntity: 'purchase_invoice', linkedId: bill.id });
    const onLine = await upload({ ...common, linkedEntity: 'purchase_invoice_line', linkedId: lineId });
    const input = { partnerId: supplierId, txnDateFrom: '2026-10-04', txnDateTo: '2026-10-04', amountFrom: '1320' };

    const forRole = async (role: string) => {
      const res = await post('attachment.evidence_search', input, role);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.items as EvidenceItem[];
      return new Map(items.map((i) => [i.id, i]));
    };
    const target = { entity: 'purchase_invoice', id: bill.id };
    for (const role of ['admin', 'accounting', 'viewer']) {
      const rows = await forRole(role);
      expect(rows.get(onBill.id)?.linked, role).toEqual({
        entity: 'purchase_invoice',
        id: bill.id,
        kind: 'document',
        readable: true,
        target,
        title: null, // purchase_invoice's display field (supplierInvoiceNo) is empty here
        number: bill.number,
        docstatus: 1,
      });
      expect(rows.get(onLine.id)?.linked, role).toEqual({
        entity: 'purchase_invoice_line',
        id: lineId,
        kind: 'line',
        readable: true,
        target,
        title: null,
        number: bill.number,
        docstatus: 1,
      });
      expect(rows.get(onBill.id)).not.toHaveProperty('storageKey');
    }
    // AC-6: sales cannot read purchase invoices, yet the evidence rows are listed (attachment's own read rule)
    const sales = await forRole('sales');
    expect([...sales.keys()].sort()).toEqual([onBill.id, onLine.id].sort());
    for (const id of [onBill.id, onLine.id])
      expect(sales.get(id)?.linked).toMatchObject({
        readable: false,
        target: null,
        title: null,
        number: null,
        docstatus: null,
      });
    expect(sales.get(onLine.id)?.linked?.kind).toBe('line');
  });

  it('AC-5 a draft target deleted by the admin becomes readable: false', async () => {
    const draft = await draftBill(supplierId, expenseId, '800');
    const evidence = await upload({ kind: 'receipt', linkedEntity: 'purchase_invoice', linkedId: draft.id });
    const before = await post('attachment.evidence_search', { kind: 'receipt' });
    const find = (body: Record<string, unknown>) => (body.items as EvidenceItem[]).find((i) => i.id === evidence.id);
    expect(find(before.body)?.linked).toMatchObject({ readable: true, number: null, docstatus: 0 });
    await act('purchase_invoice.delete', { id: draft.id });
    const after = await post('attachment.evidence_search', { kind: 'receipt' });
    expect(find(after.body)?.linked).toEqual({
      entity: 'purchase_invoice',
      id: draft.id,
      kind: 'document',
      readable: false,
      target: null,
      title: null,
      number: null,
      docstatus: null,
    });
  });

  it('AC-8 AC-9 403 without attachment read, 400 for invalid input naming the field', async () => {
    const denied = await post('attachment.evidence_search', {}, 'nobody');
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect((await post('attachment.history', { id: newId() }, 'nobody')).status).toBe(403);
    const bad = await post('attachment.evidence_search', { txnDateFrom: '2026-12-01', txnDateTo: '2026-01-01' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'txnDateFrom' }] } });
    const limit = await post('attachment.evidence_search', { limit: 500 });
    expect(limit.status).toBe(400);
    expect(limit.body.error).toMatchObject({ details: { issues: [{ path: 'limit' }] } });
    expect((await post('attachment.history', { id: newId() })).status).toBe(404);
  });

  it('AC-10 the history lists the older version with its reason, and that version downloads through the existing route', async () => {
    const v1 = await upload({ kind: 'contract' });
    const v2 = await upload({ kind: 'contract' });
    const sup = await post(
      'attachment.supersede',
      { id: v1.id, newAttachmentId: v2.id, reason: '契約書の差替' },
      'accounting',
    );
    expect(sup.status, JSON.stringify(sup.body)).toBe(200);
    const res = await post('attachment.history', { id: v2.id }, 'viewer');
    expect(res.status).toBe(200);
    const items = res.body.items as HistoryItem[];
    expect(items.map((i) => [i.id, i.relation])).toEqual([
      [v2.id, 'self'],
      [v1.id, 'older'],
    ]);
    expect(items[1]?.supersede).toMatchObject({ reason: '契約書の差替', actorType: 'user' });
    const download = await app.inject({
      method: 'GET',
      url: `/api/attachments/${v1.id}/download`,
      headers: { authorization: `Bearer ${tokens.viewer}` },
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.byteLength).toBe(v1.size);
    const meta = await app.inject({
      method: 'GET',
      url: '/meta',
      headers: { authorization: `Bearer ${tokens.viewer}` },
    });
    const actions = (meta.json() as { actions: { name: string }[] }).actions.map((a) => a.name);
    expect(actions).toEqual(expect.arrayContaining(['attachment.evidence_search', 'attachment.history']));
  });
});
