// document-links AC-2/AC-3: the related-records reader (kernel/src/related.ts) and the derived <entity>.related action.
// Test-only entities mirror the real shapes: an invoice with a journalEntryId ref and lines, a journal-like entry with the
// sourceEntity/sourceId pair and a reversalOf self-ref, a receipt whose allocation lines point at invoices through the
// invoiceEntity/invoiceId pair, a note whose link field is masked for some roles, and an item some roles cannot read.
// An order with two header refs and a line ref to the same entity, and a shipment whose lines point at order lines (the
// trade_fulfillment_line.orderLineId shape), cover the per-item linking field and links held by / pointing at lines.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  amendDocument,
  cancelDocument,
  companies,
  defineDocument,
  defineEntity,
  f,
  label,
  newId,
  registerCrudActions,
  RELATED_LIMIT,
  relatedRecords,
  repo,
  runAction,
  saveLines,
  submitDocument,
  type RelatedResult,
} from '../src/index.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { TPartner } from './fixtures/entities.ts';

const RelEntry = defineDocument({
  name: 'rel_entry',
  label: label('関連テスト仕訳', 'Related test entry'),
  naming: { type: 'sequence', prefix: 'RE-' },
  fields: {
    date: f.date({ required: true, default: 'today' }),
    description: f.text(),
    sourceEntity: f.text({ maxLength: 100 }),
    sourceId: f.uuid(),
    reversalOf: f.ref('rel_entry'),
  },
  displayField: 'description',
  permissions: { roles: { clerk: ['read', 'create', 'update', 'submit'], auditor: ['read'], sales: ['read'] } },
});
const RelItem = defineEntity({
  name: 'rel_item',
  label: label('関連テスト品目', 'Related test item'),
  fields: { name: f.text({ required: true }), code: f.text({ unique: true }) },
  permissions: { roles: { clerk: ['read', 'create'] } },
});
const RelInvoice = defineDocument({
  name: 'rel_invoice',
  label: label('関連テスト請求書', 'Related test invoice'),
  naming: { type: 'sequence', prefix: 'RI-' },
  fields: {
    partnerId: f.ref(TPartner.name, { required: true }),
    date: f.date({ required: true, default: 'today' }),
    dueDate: f.date(),
    amount: f.money({ required: true, default: '0' }),
    journalEntryId: f.ref('rel_entry'),
  },
  lines: [{ entity: 'rel_invoice_line', parentField: 'invoiceId' }],
  permissions: {
    roles: {
      clerk: ['read', 'create', 'update', 'submit', 'cancel', 'amend'],
      auditor: ['read'],
      sales: ['read'],
    },
  },
});
defineEntity({
  name: 'rel_invoice_line',
  label: label('関連テスト請求明細', 'Related test invoice line'),
  fields: {
    invoiceId: f.ref('rel_invoice', { required: true, onDelete: 'cascade' }),
    seq: f.int({ required: true, default: 1 }),
    itemId: f.ref('rel_item'),
    amount: f.money({ required: true, default: '0' }),
  },
  permissions: { roles: { clerk: ['read', 'create', 'update', 'delete'], auditor: ['read'], sales: ['read'] } },
});
const RelReceipt = defineDocument({
  name: 'rel_receipt',
  label: label('関連テスト入出金', 'Related test receipt'),
  naming: { type: 'sequence', prefix: 'RR-' },
  fields: {
    direction: f.enum(['in', 'out'], { required: true }),
    date: f.date({ required: true, default: 'today' }),
    amount: f.money({ required: true, default: '0' }),
  },
  lines: [{ entity: 'rel_allocation', parentField: 'receiptId' }],
  permissions: {
    roles: { clerk: ['read', 'create', 'update', 'submit'], auditor: ['read'] },
    rowRules: [{ roles: ['auditor'], where: { direction: 'in' } }],
  },
});
defineEntity({
  name: 'rel_allocation',
  label: label('関連テスト消込', 'Related test allocation'),
  fields: {
    receiptId: f.ref('rel_receipt', { required: true, onDelete: 'cascade' }),
    seq: f.int({ required: true, default: 1 }),
    invoiceEntity: f.enum(['rel_invoice'], { required: true }),
    invoiceId: f.uuid({ required: true }),
    amount: f.money({ required: true, default: '0' }),
  },
  permissions: { roles: { clerk: ['read', 'create', 'update', 'delete'], auditor: ['read'] } },
});
const RelTag = defineEntity({
  name: 'rel_tag',
  label: label('関連テスト分類', 'Related test tag'),
  scope: 'tenant',
  fields: { name: f.text({ required: true }) },
  permissions: { roles: { clerk: ['read', 'create'] } },
});
const RelNote = defineEntity({
  name: 'rel_note',
  label: label('関連テストメモ', 'Related test note'),
  fields: {
    invoiceId: f.ref('rel_invoice', { required: true }),
    body: f.text({ required: true }),
    tagId: f.ref('rel_tag'),
  },
  displayField: 'body',
  permissions: {
    roles: { clerk: ['read', 'create'], auditor: ['read'] },
    fieldGroups: { link: { fields: ['invoiceId'], roles: ['clerk'] } },
  },
});
const RelOrder = defineDocument({
  name: 'rel_order',
  label: label('関連テスト受注', 'Related test order'),
  naming: { type: 'sequence', prefix: 'RO-' },
  fields: {
    date: f.date({ required: true, default: 'today' }),
    mainItemId: f.ref('rel_item'),
    backupItemId: f.ref('rel_item'),
  },
  lines: [{ entity: 'rel_order_line', parentField: 'orderId' }],
  permissions: { roles: { clerk: ['read', 'create', 'update'], shipper: ['read'] } },
});
const RelOrderLine = defineEntity({
  name: 'rel_order_line',
  label: label('関連テスト受注明細', 'Related test order line'),
  fields: {
    orderId: f.ref('rel_order', { required: true, onDelete: 'cascade' }),
    seq: f.int({ required: true, default: 1 }),
    itemId: f.ref('rel_item'),
  },
  permissions: { roles: { clerk: ['read', 'create', 'update', 'delete'] } },
});
const RelShip = defineDocument({
  name: 'rel_ship',
  label: label('関連テスト出荷', 'Related test shipment'),
  naming: { type: 'sequence', prefix: 'RS-' },
  fields: { date: f.date({ required: true, default: 'today' }) },
  lines: [{ entity: 'rel_ship_line', parentField: 'shipId' }],
  permissions: { roles: { clerk: ['read', 'create', 'update'], shipper: ['read'] } },
});
defineEntity({
  name: 'rel_ship_line',
  label: label('関連テスト出荷明細', 'Related test shipment line'),
  fields: {
    shipId: f.ref('rel_ship', { required: true, onDelete: 'cascade' }),
    seq: f.int({ required: true, default: 1 }),
    orderLineId: f.ref('rel_order_line', { required: true }),
  },
  permissions: { roles: { clerk: ['read', 'create', 'update', 'delete'], shipper: ['read'] } },
});
registerCrudActions();

let db: TestDb;
let partnerId: string;
let otherOwnerPartnerId: string;
let items: string[];
let invoiceId: string;
let entryId: string;
let reversalId: string;
let receiptIn: string;
let receiptOut: string;
let noteId: string;

const related = (entity: Parameters<typeof relatedRecords>[1], id: string, roles = ['admin']) =>
  db.run({ roles }, (ctx) => relatedRecords(ctx, entity, id));
const group = (r: RelatedResult, entity: string) => r.groups.find((g) => g.entity === entity);
const ids = (r: RelatedResult, entity: string) => (group(r, entity)?.items ?? []).map((i) => i.id).sort();

beforeAll(async () => {
  db = await freshDb();
  partnerId = (await db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'Related partner' }))).id;
  otherOwnerPartnerId = (
    await db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'Owned by someone else', ownerId: newId() }))
  ).id;
  items = await db.run({}, async (ctx) => [
    (await repo(ctx, RelItem).create({ name: 'Item A', code: 'A' })).id,
    (await repo(ctx, RelItem).create({ name: 'Item B', code: 'B' })).id,
  ]);
  invoiceId = await db.run({}, async (ctx) => {
    const inv = await repo(ctx, RelInvoice).create({ partnerId, date: '2026-10-01', amount: '300' });
    await saveLines(ctx, RelInvoice, inv.id, {
      rel_invoice_line: [
        { itemId: items[0], amount: '100' },
        { itemId: items[1], amount: '200' },
      ],
    });
    return inv.id;
  });
  [entryId, reversalId] = await db.run({}, async (ctx) => {
    const e = await repo(ctx, RelEntry).create({
      date: '2026-10-01',
      description: 'Posting',
      sourceEntity: 'rel_invoice',
      sourceId: invoiceId,
    });
    await repo(ctx, RelInvoice).update(invoiceId, { journalEntryId: e.id });
    const rev = await repo(ctx, RelEntry).create({
      date: '2026-10-02',
      description: 'Reversal',
      sourceEntity: 'rel_invoice',
      sourceId: invoiceId,
      reversalOf: e.id,
    });
    return [e.id, rev.id];
  });
  [receiptIn, receiptOut] = await db.run({}, async (ctx) => {
    const out: string[] = [];
    for (const direction of ['in', 'out'] as const) {
      const r = await repo(ctx, RelReceipt).create({ direction, date: '2026-10-03', amount: '100' });
      await saveLines(ctx, RelReceipt, r.id, {
        rel_allocation: [{ invoiceEntity: 'rel_invoice', invoiceId, amount: '100' }],
      });
      out.push(r.id);
    }
    return out as [string, string];
  });
  noteId = (await db.run({}, (ctx) => repo(ctx, RelNote).create({ invoiceId, body: 'Call the customer' }))).id;
});
afterAll(async () => {
  await db.close();
});

describe('document-links AC-2: references, referencing records, journal entries and amendments', () => {
  it('AC-2: an invoice lists what it references (header and lines) and what references it, grouped by entity', async () => {
    const r = await related(RelInvoice, invoiceId);
    expect(r).toMatchObject({ entity: 'rel_invoice', id: invoiceId });
    expect(ids(r, TPartner.name)).toEqual([partnerId]);
    expect(group(r, TPartner.name)?.items[0]).toMatchObject({
      relation: 'references',
      via: 'partnerId',
      title: 'Related partner',
      number: null,
      docstatus: null,
    });
    // journalEntryId (references) and the sourceEntity/sourceId pair (the posting and its reversal) in one group
    expect(ids(r, 'rel_entry')).toEqual([entryId, reversalId].sort());
    const entries = group(r, 'rel_entry')?.items ?? [];
    expect(entries.find((i) => i.id === entryId)).toMatchObject({
      relation: 'references',
      via: 'journalEntryId',
      title: 'Posting',
      docstatus: 0,
      date: '2026-10-01',
    });
    expect(entries.find((i) => i.id === reversalId)).toMatchObject({
      relation: 'referenced_by',
      via: 'rel_entry.sourceId',
    });
    // line refs count as the invoice's; allocation lines pointing at the invoice stand for their receipts
    expect(ids(r, 'rel_item')).toEqual([...items].sort());
    expect(group(r, 'rel_item')?.items[0]?.via).toBe('rel_invoice_line.itemId');
    expect(ids(r, 'rel_receipt')).toEqual([receiptIn, receiptOut].sort());
    expect(group(r, 'rel_receipt')?.items[0]).toMatchObject({
      relation: 'referenced_by',
      via: 'rel_allocation.invoiceId',
    });
    expect(ids(r, 'rel_note')).toEqual([noteId]);
    // the invoice's own lines are part of the record, and the record itself never appears
    expect(group(r, 'rel_invoice_line')).toBeUndefined();
    expect(group(r, 'rel_allocation')).toBeUndefined();
    expect(group(r, 'rel_invoice')).toBeUndefined();
    expect(r.groups.every((g) => g.more === false)).toBe(true);
    expect(group(r, 'rel_receipt')?.label).toEqual({ ja: '関連テスト入出金', en: 'Related test receipt' });
  });

  it('AC-2: the polymorphic links resolve from the other side (receipt -> invoice, entry -> source and reversal)', async () => {
    const receipt = await related(RelReceipt, receiptIn);
    expect(ids(receipt, 'rel_invoice')).toEqual([invoiceId]);
    expect(group(receipt, 'rel_invoice')?.items[0]).toMatchObject({
      relation: 'references',
      via: 'rel_allocation.invoiceId',
    });
    const entry = await related(RelEntry, entryId);
    expect(ids(entry, 'rel_invoice')).toEqual([invoiceId]);
    expect(group(entry, 'rel_invoice')?.items[0]).toMatchObject({ relation: 'references', via: 'sourceId' });
    expect(ids(entry, 'rel_entry')).toEqual([reversalId]);
    expect(group(entry, 'rel_entry')?.items[0]).toMatchObject({
      relation: 'referenced_by',
      via: 'rel_entry.reversalOf',
    });
  });

  it('AC-2: the amendedFrom chain is listed in both directions, oldest version included', async () => {
    const [first, second, third] = await db.run({}, async (ctx) => {
      const draft = await repo(ctx, RelInvoice).create({ partnerId, date: '2026-10-05', amount: '1' });
      await submitDocument(ctx, RelInvoice, draft.id);
      await cancelDocument(ctx, RelInvoice, draft.id);
      const v2 = await amendDocument(ctx, RelInvoice, draft.id);
      await submitDocument(ctx, RelInvoice, v2.id);
      await cancelDocument(ctx, RelInvoice, v2.id);
      const v3 = await amendDocument(ctx, RelInvoice, v2.id);
      return [draft.id, v2.id, v3.id];
    });
    const middle = await related(RelInvoice, second);
    expect(group(middle, 'rel_invoice')?.items.map((i) => [i.id, i.relation])).toEqual([
      [first, 'amended_from'],
      [third, 'amendment'],
    ]);
    expect(group(middle, 'rel_invoice')?.items[0]).toMatchObject({
      docstatus: 2,
      number: expect.stringMatching(/^RI-/),
    });
    const latest = await related(RelInvoice, third);
    expect(group(latest, 'rel_invoice')?.items.map((i) => [i.id, i.relation])).toEqual([
      [second, 'amended_from'],
      [first, 'amended_from'],
    ]);
    const oldest = await related(RelInvoice, first);
    expect(group(oldest, 'rel_invoice')?.items.map((i) => [i.id, i.relation])).toEqual([
      [second, 'amendment'],
      [third, 'amendment'],
    ]);
  });

  it('AC-2: at most 50 records per entity, with more=true, in both directions', async () => {
    const { busyInvoice, manyItems } = await db.run({}, async (ctx) => {
      const created: string[] = [];
      for (let i = 0; i < 52; i++)
        created.push((await repo(ctx, RelItem).create({ name: `Bulk ${i}`, code: `BULK-${i}` })).id);
      const inv = await repo(ctx, RelInvoice).create({ partnerId, date: '2026-10-06', amount: '0' });
      await saveLines(ctx, RelInvoice, inv.id, {
        rel_invoice_line: created.map((itemId) => ({ itemId, amount: '1' })),
      });
      for (let i = 0; i < 53; i++) await repo(ctx, RelNote).create({ invoiceId: inv.id, body: `Note ${i}` });
      return { busyInvoice: inv.id, manyItems: created };
    });
    const r = await related(RelInvoice, busyInvoice);
    expect(RELATED_LIMIT).toBe(50);
    expect(group(r, 'rel_item')?.items).toHaveLength(RELATED_LIMIT);
    expect(group(r, 'rel_item')?.more).toBe(true);
    expect(group(r, 'rel_item')?.items.every((i) => manyItems.includes(i.id))).toBe(true);
    expect(group(r, 'rel_note')?.items).toHaveLength(RELATED_LIMIT);
    expect(group(r, 'rel_note')?.more).toBe(true);
  });

  it('AC-2: each item names the field it was reached through (two header refs and a line ref to one entity)', async () => {
    const [a, b] = items as [string, string];
    const c = (await db.run({}, (ctx) => repo(ctx, RelItem).create({ name: 'Item C', code: 'C' }))).id;
    const orderId = await db.run({}, async (ctx) => {
      const order = await repo(ctx, RelOrder).create({ date: '2026-10-08', mainItemId: a, backupItemId: b });
      await saveLines(ctx, RelOrder, order.id, { rel_order_line: [{ itemId: c }, { itemId: a }] });
      return order.id;
    });
    const r = await related(RelOrder, orderId);
    const vias = Object.fromEntries((group(r, 'rel_item')?.items ?? []).map((i) => [i.id, i.via]));
    // a line ref to an item the header already names keeps the header field (first link found wins)
    expect(vias).toEqual({ [a]: 'mainItemId', [b]: 'backupItemId', [c]: 'rel_order_line.itemId' });
    expect(group(r, 'rel_order_line')).toBeUndefined();
  });

  it("AC-2: a line pointing at another document's line stands for that document, from both sides", async () => {
    const { orderId, shipId } = await db.run({}, async (ctx) => {
      const order = await repo(ctx, RelOrder).create({ date: '2026-10-09' });
      await saveLines(ctx, RelOrder, order.id, { rel_order_line: [{ itemId: items[0] }, { itemId: items[1] }] });
      const lines = await repo(ctx, RelOrderLine).list({ where: { orderId: order.id }, limit: 10 });
      const ship = await repo(ctx, RelShip).create({ date: '2026-10-10' });
      await saveLines(ctx, RelShip, ship.id, {
        rel_ship_line: lines.items.map((l) => ({ orderLineId: l.id })),
      });
      return { orderId: order.id, shipId: ship.id };
    });
    const ship = await related(RelShip, shipId);
    expect(ids(ship, 'rel_order')).toEqual([orderId]);
    expect(group(ship, 'rel_order')?.items[0]).toMatchObject({
      relation: 'references',
      via: 'rel_ship_line.orderLineId',
      number: null,
      docstatus: 0,
    });
    expect(group(ship, 'rel_order_line')).toBeUndefined();
    expect(group(ship, 'rel_ship_line')).toBeUndefined();
    const order = await related(RelOrder, orderId);
    expect(ids(order, 'rel_ship')).toEqual([shipId]);
    expect(group(order, 'rel_ship')?.items[0]).toMatchObject({
      relation: 'referenced_by',
      via: 'rel_ship_line.orderLineId',
    });
    expect(group(order, 'rel_ship_line')).toBeUndefined();
    expect(group(order, 'rel_order_line')).toBeUndefined();
    // AC-3: a caller who cannot read the order lines cannot resolve either side through them
    const shipper = await related(RelShip, shipId, ['shipper']);
    expect(shipper.groups).toEqual([]);
    const shipperOrder = await related(RelOrder, orderId, ['shipper']);
    expect(group(shipperOrder, 'rel_ship')).toBeUndefined();
  });
});

describe('document-links AC-3: read permission, row rules, masks and scope per related entity', () => {
  it('AC-3: unreadable entities and entities whose link field is masked are left out entirely; row rules filter rows', async () => {
    const r = await related(RelInvoice, invoiceId, ['auditor']);
    expect(group(r, 'rel_item')).toBeUndefined(); // auditor cannot read items
    expect(group(r, TPartner.name)).toBeUndefined(); // nor partners
    expect(group(r, 'rel_note')).toBeUndefined(); // can read notes, but rel_note.invoiceId is masked
    expect(ids(r, 'rel_receipt')).toEqual([receiptIn]); // row rule: direction 'in' only
    expect(ids(r, 'rel_entry')).toEqual([entryId, reversalId].sort());
    expect(r.groups.map((g) => g.entity).sort()).toEqual(['rel_entry', 'rel_receipt']);
  });

  it('AC-3: a row rule on the referenced entity hides the row (own-records rule on partners)', async () => {
    const own = await related(RelInvoice, invoiceId, ['sales']);
    expect(ids(own, TPartner.name)).toEqual([partnerId]); // ownerId null is visible to sales
    const foreign = await db.run(
      {},
      async (ctx) => (await repo(ctx, RelInvoice).create({ partnerId: otherOwnerPartnerId, date: '2026-10-07' })).id,
    );
    const hidden = await related(RelInvoice, foreign, ['sales']);
    expect(group(hidden, TPartner.name)).toBeUndefined();
    expect(ids(await related(RelInvoice, foreign), TPartner.name)).toEqual([otherOwnerPartnerId]);
  });

  it('AC-3: records of another company never appear, even through an unchecked uuid link', async () => {
    const companyB = newId();
    await db.owner.drizzle.insert(companies).values({ id: companyB, tenantId: db.tenantId, code: 'RB', name: 'B' });
    await db.run({ companyId: companyB }, (ctx) =>
      repo(ctx, RelEntry).create({ description: 'Other company', sourceEntity: 'rel_invoice', sourceId: invoiceId }),
    );
    const r = await related(RelInvoice, invoiceId);
    expect(ids(r, 'rel_entry')).toEqual([entryId, reversalId].sort());
  });

  it('AC-3: a tenant-wide record read without a company lists no company records (and does not fail)', async () => {
    const tagId = (await db.run({}, (ctx) => repo(ctx, RelTag).create({ name: 'Urgent' }))).id;
    await db.run({}, (ctx) => repo(ctx, RelNote).create({ invoiceId, body: 'Tagged', tagId }));
    const inCompany = await related(RelTag, tagId);
    expect(group(inCompany, 'rel_note')?.items.map((i) => i.title)).toEqual(['Tagged']);
    const tenantOnly = await db.run({ companyId: null }, (ctx) => relatedRecords(ctx, RelTag, tagId));
    expect(tenantOnly.groups).toEqual([]);
  });

  it('AC-3: the derived action checks read permission on the record itself and validates its output', async () => {
    const out = (await db.run({ roles: ['auditor'] }, (ctx) =>
      runAction(ctx, 'rel_invoice.related', { id: invoiceId }),
    )) as RelatedResult;
    expect(out.groups.map((g) => g.entity).sort()).toEqual(['rel_entry', 'rel_receipt']);
    await expect(
      db.run({ roles: ['nobody'] }, (ctx) => runAction(ctx, 'rel_invoice.related', { id: invoiceId })),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      db.run({ roles: ['auditor'] }, (ctx) => runAction(ctx, 'rel_invoice.related', { id: newId() })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // a receipt the auditor's row rule hides is NotFound, not an empty result
    await expect(
      db.run({ roles: ['auditor'] }, (ctx) => runAction(ctx, 'rel_receipt.related', { id: receiptOut })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
