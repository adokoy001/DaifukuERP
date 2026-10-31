// document-links AC-2/AC-3 over REST with the real modules: GET /api/:entity/:id/related for a submitted sales invoice
// that a receipt allocated (payment_allocation.invoiceId stands for its payment) and that posted a journal entry
// (journalEntryId and journal_entry.sourceEntity/sourceId), the per-item linking field on a posted purchase invoice, the
// per-role omission of unreadable entities, and the reviewed list of user-writable <x>Entity/<x>Id link pairs.
import { companyMemberships, hashPassword, newId, registry, relatedLinkSpecs, runAction, users } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { modules } from '../src/modules.ts';
import { buildServer } from '../src/server.ts';

interface Group {
  entity: string;
  label: { ja: string; en: string };
  items: { id: string; relation: string; via: string; number: string | null; docstatus: number | null }[];
  more: boolean;
}

let db: TestDb;
let app: FastifyInstance;
let adminToken: string;
let salesToken: string;

const act = (name: string, input: unknown) =>
  db.run({}, (ctx) => runAction(ctx, name, input)) as Promise<Record<string, unknown> & { id: string }>;

async function get(url: string, token = adminToken): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

const groupsOf = (body: Record<string, unknown>) => body.groups as Group[];
const group = (body: Record<string, unknown>, entity: string) => groupsOf(body).find((g) => g.entity === entity);

beforeAll(async () => {
  db = await freshDb();
  await db.run({}, async (ctx) => {
    for (const module of modules) await module.seed?.(ctx);
  });
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'related-test', logger: false });
  await app.ready();
  adminToken = app.jwt.sign({ sub: db.adminUserId, tenantId: db.tenantId, sessionVersion: 1 });
  const salesId = newId();
  await db.owner.drizzle.insert(users).values({
    id: salesId,
    tenantId: db.tenantId,
    email: 'related-sales@example.com',
    name: 'Related sales',
    passwordHash: await hashPassword('sales-pw'),
    roles: ['sales'],
    defaultCompanyId: db.companyId,
  });
  await db.owner.drizzle
    .insert(companyMemberships)
    .values({ tenantId: db.tenantId, userId: salesId, companyId: db.companyId, roles: ['sales'] });
  salesToken = app.jwt.sign({ sub: salesId, tenantId: db.tenantId, sessionVersion: 1 });
});
afterAll(async () => {
  await app.close();
  await db.close();
});

async function paidInvoice() {
  const customer = await act('partner.create', { name: 'Related customer', isCustomer: true });
  const draft = await act('sales_invoice.create', {
    partnerId: customer.id,
    date: '2026-10-01',
    lines: {
      sales_invoice_line: [{ description: 'Service', quantity: '1', unitPrice: '1000', taxCategory: 'standard' }],
    },
  });
  const invoice = await act('sales_invoice.submit', { id: draft.id });
  const receipt = await act('payment.create', {
    direction: 'receive',
    partnerId: customer.id,
    date: '2026-10-02',
    amount: String(invoice.balance),
    lines: {
      payment_allocation: [{ invoiceEntity: 'sales_invoice', invoiceId: invoice.id, amount: String(invoice.balance) }],
    },
  });
  const payment = await act('payment.submit', { id: receipt.id });
  return { customer, invoice, payment };
}

describe('document-links AC-2: GET /api/:entity/:id/related with the real modules', () => {
  it('AC-2: a paid sales invoice lists its customer, its receipt (via the allocation line) and its journal entry', async () => {
    const { customer, invoice, payment } = await paidInvoice();
    const res = await get(`/api/sales_invoice/${invoice.id}/related`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ entity: 'sales_invoice', id: invoice.id });
    expect(group(res.body, 'partner')?.items.map((i) => i.id)).toEqual([customer.id]);
    expect(group(res.body, 'payment')?.items).toEqual([
      expect.objectContaining({
        id: payment.id,
        relation: 'referenced_by',
        via: 'payment_allocation.invoiceId',
        number: payment.number,
        docstatus: 1,
      }),
    ]);
    expect(group(res.body, 'payment')?.label).toEqual({ ja: '入出金', en: 'Payment' });
    const entries = group(res.body, 'journal_entry')?.items ?? [];
    expect(entries.map((e) => e.id)).toContain(invoice.journalEntryId);
    expect(entries.find((e) => e.id === invoice.journalEntryId)).toMatchObject({
      relation: 'references',
      via: 'journalEntryId',
      docstatus: 1,
    });
    expect(group(res.body, 'sales_invoice_line')).toBeUndefined();
    expect(group(res.body, 'payment_allocation')).toBeUndefined();

    const back = await get(`/api/payment/${payment.id}/related`);
    expect(back.status).toBe(200);
    expect(group(back.body, 'sales_invoice')?.items).toEqual([
      expect.objectContaining({ id: invoice.id, relation: 'references', via: 'payment_allocation.invoiceId' }),
    ]);
    expect(group(back.body, 'journal_entry')?.items.map((e) => e.id)).toContain(payment.journalEntryId);

    const entry = await get(`/api/journal_entry/${String(invoice.journalEntryId)}/related`);
    expect(group(entry.body, 'sales_invoice')?.items.map((i) => i.id)).toEqual([invoice.id]);
  });

  it('AC-2: the cancelled original and its amendment point at each other', async () => {
    const customer = await act('partner.create', { name: 'Amend customer', isCustomer: true });
    const draft = await act('sales_invoice.create', {
      partnerId: customer.id,
      date: '2026-10-03',
      lines: {
        sales_invoice_line: [{ description: 'Service', quantity: '1', unitPrice: '500', taxCategory: 'standard' }],
      },
    });
    await act('sales_invoice.submit', { id: draft.id });
    await act('sales_invoice.cancel', { id: draft.id });
    const amended = await act('sales_invoice.amend', { id: draft.id });
    const original = await get(`/api/sales_invoice/${draft.id}/related`);
    expect(group(original.body, 'sales_invoice')?.items).toEqual([
      expect.objectContaining({ id: amended.id, relation: 'amendment', via: 'amendedFrom', docstatus: 0 }),
    ]);
    // the posting names the original as its source; its reversal is one hop further, on the posting's own panel
    const posted = await act('sales_invoice.get', { id: draft.id });
    expect(group(original.body, 'journal_entry')?.items.map((e) => e.id)).toContain(posted.journalEntryId);
    const posting = await get(`/api/journal_entry/${String(posted.journalEntryId)}/related`);
    expect(group(posting.body, 'journal_entry')?.items).toEqual([
      expect.objectContaining({ relation: 'referenced_by', via: 'journal_entry.reversalOf', docstatus: 1 }),
    ]);
    const amendment = await get(`/api/sales_invoice/${amended.id}/related`);
    expect(group(amendment.body, 'sales_invoice')?.items).toEqual([
      expect.objectContaining({ id: draft.id, relation: 'amended_from', docstatus: 2 }),
    ]);
  });
});

describe('document-links AC-3: per-role reads over REST', () => {
  it('AC-3: a sales user sees the receipt and the journal entry; unreadable entities are omitted', async () => {
    const { invoice, payment } = await paidInvoice();
    const res = await get(`/api/sales_invoice/${invoice.id}/related`, salesToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(group(res.body, 'payment')?.items.map((i) => i.id)).toEqual([payment.id]);
    expect(group(res.body, 'journal_entry')?.items.map((i) => i.id)).toContain(invoice.journalEntryId);
    // purchasing-only documents never show up for a sales user, not even as an empty group
    const entities = groupsOf(res.body).map((g) => g.entity);
    expect(entities).not.toContain('purchase_invoice');
  });

  it('AC-3: the record itself must be readable; unknown entities and malformed ids are refused', async () => {
    const supplier = await act('partner.create', { name: 'Related supplier', isSupplier: true });
    const expense = (await act('account.list', { where: { type: 'expense' }, limit: 1 })) as unknown as {
      items: { id: string }[];
    };
    const bill = await act('purchase_invoice.create', {
      partnerId: supplier.id,
      date: '2026-10-04',
      lines: {
        purchase_invoice_line: [
          {
            accountId: expense.items[0]?.id,
            description: 'Goods',
            quantity: '1',
            unitPrice: '300',
            taxCategory: 'standard',
          },
        ],
      },
    });
    const denied = await get(`/api/purchase_invoice/${bill.id}/related`, salesToken);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect((await get(`/api/purchase_invoice/${bill.id}/related`)).status).toBe(200);
    // AC-2: once posted, the control account (header) and the expense account (line) each carry their own field
    const posted = await act('purchase_invoice.submit', { id: bill.id });
    const accounts = group((await get(`/api/purchase_invoice/${bill.id}/related`)).body, 'account')?.items ?? [];
    expect(accounts.find((a) => a.id === posted.controlAccountId)?.via).toBe('controlAccountId');
    expect(accounts.find((a) => a.id === expense.items[0]?.id)?.via).toBe('purchase_invoice_line.accountId');
    expect((await get(`/api/sales_invoice/${newId()}/related`)).status).toBe(404);
    expect((await get(`/api/no_such_entity/${newId()}/related`)).status).toBe(404);
    expect((await get('/api/sales_invoice/not-a-uuid/related')).status).toBe(400);
  });
});

describe('document-links AC-3: <x>Entity/<x>Id link pairs', () => {
  // A pair is followed by name only, and the kernel does not check it on write the way it checks a `ref`. Each pair a
  // user may write must therefore check its target on write (docs/architecture/runtime-and-data.md#関連記録の読取).
  // A new pair fails here until its write path has been reviewed and added to this list.
  const WRITE_CHECKED: Record<string, string> = {
    'attachment.linkedEntity/linkedId': 'modules/attachments/src/hooks/integrity.ts (assertLinkTarget)',
    'payment_allocation.invoiceEntity/invoiceId': 'modules/payment/src/hooks/lines.ts (loadInvoice, same partner)',
    'stock_entry.sourceEntity/sourceId': 'modules/inventory/src/hooks/entry.ts (cleared unless a module writes)',
    'stock_ledger.sourceEntity/sourceId': 'modules/inventory/src/hooks/guard.ts (module writes only)',
  };
  it('AC-3: every pair is server-owned or in the reviewed list of write-checked pairs', () => {
    const pairs = registry.allEntities().flatMap((entity) =>
      relatedLinkSpecs(entity)
        .filter((link) => link.entityField !== undefined)
        .map((link) => ({
          pair: `${entity.name}.${String(link.entityField)}/${link.idField}`,
          serverOwned: entity.config.fields[link.idField]?.opts.serverOwned === true,
        })),
    );
    expect(pairs.filter((p) => p.serverOwned).map((p) => p.pair)).toEqual(
      expect.arrayContaining(['journal_entry.sourceEntity/sourceId']),
    );
    expect(
      pairs
        .filter((p) => !p.serverOwned)
        .map((p) => p.pair)
        .sort(),
    ).toEqual(Object.keys(WRITE_CHECKED).sort());
  });
});
