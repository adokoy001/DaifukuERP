// docs/specs/evidence-search.md AC-1..AC-11 against Postgres: the 3-key search and every combination (AND), ranges,
// the supersede / "search keys missing" filters, the per-page limits of the link summary and the supersede counts, the
// supersede tree (chain, branch, deep row, missing audit entry), company isolation, permissions and validation. Linked
// documents and their lines, and per-role link visibility, are covered with the real modules in
// apps/api/test/evidence-search.db.test.ts.
import {
  configureStorage,
  LocalStorage,
  newId,
  NotFound,
  PermissionDenied,
  registerCrudActions,
  repo,
  runAction,
  type Context,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Partner } from '@daifuku/mod-partner';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Attachment, uploadAttachment, type AttachmentRow, type EvidenceItem, type HistoryItem } from '../src/index.ts';
import { withSupersede } from '../src/write.ts';

let db: TestDb;
let seq = 0;

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  configureStorage(new LocalStorage(await mkdtemp(join(tmpdir(), 'daifuku-evidence-'))));
});
afterAll(async () => {
  await db.close();
});

const asRole = (roles: string[], extra: Record<string, unknown> = {}) => ({
  roles,
  actor: { type: 'user' as const, id: newId() },
  ...extra,
});

async function newCompany(code: string): Promise<string> {
  const id = newId();
  await db.owner
    .sql`insert into companies (id, tenant_id, code, name) values (${id}, ${db.tenantId}, ${code}, ${`証憑 ${code}`})`;
  return id;
}

function upload(
  ctx: Context,
  fields: Record<string, string | undefined> = {},
  filename?: string,
): Promise<AttachmentRow> {
  seq += 1;
  return uploadAttachment(ctx, {
    data: new TextEncoder().encode(`evidence-search #${seq} ${newId()}`),
    filename: filename ?? `ev-${seq}.pdf`,
    contentType: 'application/pdf',
    fields,
  });
}

interface SearchResult {
  items: EvidenceItem[];
  total: number;
  limit: number;
  offset: number;
}
const search = (params: Record<string, unknown>, input: Record<string, unknown>) =>
  db.run(params, (ctx) => runAction(ctx, 'attachment.evidence_search', input)) as Promise<SearchResult>;
const history = (params: Record<string, unknown>, id: string) =>
  db.run(params, (ctx) => runAction(ctx, 'attachment.history', { id })) as Promise<{
    id: string;
    items: HistoryItem[];
    truncated: boolean;
  }>;
const supersede = (params: Record<string, unknown>, id: string, newAttachmentId: string, reason: string) =>
  db.run(params, (ctx) => runAction(ctx, 'attachment.supersede', { id, newAttachmentId, reason }));

describe('attachment.evidence_search: the three keys and their combinations (AC-1, AC-2)', () => {
  let company: string;
  let p1: string;
  let p2: string;
  const ids: Record<string, string> = {};
  const inCo = () => ({ companyId: company });
  const keysOf = (res: SearchResult) =>
    res.items.map((i) => Object.entries(ids).find(([, id]) => id === i.id)?.[0] ?? `?${i.id}`);
  const run = async (input: Record<string, unknown>) => {
    const res = await search(inCo(), input);
    return { keys: keysOf(res).sort(), total: res.total, res };
  };

  beforeAll(async () => {
    company = await newCompany('EV-AND');
    p1 = (await db.run(inCo(), (ctx) => repo(ctx, Partner).create({ name: '検索取引先1' }))).id;
    p2 = (await db.run(inCo(), (ctx) => repo(ctx, Partner).create({ name: '検索取引先2' }))).id;
    // Each criterion and each pair matches a different set, so a missing AND shows up as an extra row.
    const rows: [string, Record<string, string>][] = [
      ['d1', { txnDate: '2025-01-10', amount: '1000', partnerId: p1 }],
      ['d2', { txnDate: '2025-01-20', amount: '5000', partnerId: p1 }],
      ['d3', { txnDate: '2025-02-15', amount: '1000', partnerId: p2 }],
      ['d4', { txnDate: '2025-02-15', amount: '5000', partnerId: p2 }],
      ['d5', { txnDate: '2025-03-01', amount: '3000', partnerId: p1 }],
      ['d6', { txnDate: '2025-01-15', amount: '3000', partnerId: p2 }],
      ['dateOnly', { txnDate: '2025-01-12' }],
      ['none', {}],
    ];
    for (const [key, fields] of rows) ids[key] = (await db.run(inCo(), (ctx) => upload(ctx, fields))).id;
  });

  const JAN = { txnDateFrom: '2025-01-01', txnDateTo: '2025-01-31' };
  const MID = { amountFrom: '1000', amountTo: '3000' };

  it('AC-1 each key alone: a date range, an amount range, a partner', async () => {
    expect((await run(JAN)).keys).toEqual(['d1', 'd2', 'd6', 'dateOnly']);
    expect((await run(MID)).keys).toEqual(['d1', 'd3', 'd5', 'd6']);
    expect((await run({ partnerId: p1 })).keys).toEqual(['d1', 'd2', 'd5']);
  });

  it('AC-2 any two keys and all three are ANDed (date x amount, date x partner, amount x partner, all)', async () => {
    expect(await run({ ...JAN, ...MID })).toMatchObject({ keys: ['d1', 'd6'], total: 2 });
    expect(await run({ ...JAN, partnerId: p1 })).toMatchObject({ keys: ['d1', 'd2'], total: 2 });
    expect(await run({ ...MID, partnerId: p1 })).toMatchObject({ keys: ['d1', 'd5'], total: 2 });
    expect(await run({ ...JAN, ...MID, partnerId: p1 })).toMatchObject({ keys: ['d1'], total: 1 });
    expect(await run({ ...JAN, ...MID, partnerId: p2 })).toMatchObject({ keys: ['d6'], total: 1 });
    expect((await run({ ...JAN, amountFrom: '9000', partnerId: p1 })).total).toBe(0);
  });

  it('AC-1 one-sided ranges, both ends equal, inclusive bounds; rows without the key never match its range', async () => {
    expect((await run({ txnDateFrom: '2025-02-15' })).keys).toEqual(['d3', 'd4', 'd5']);
    expect((await run({ txnDateTo: '2025-01-12' })).keys).toEqual(['d1', 'dateOnly']);
    expect((await run({ txnDateFrom: '2025-02-15', txnDateTo: '2025-02-15' })).keys).toEqual(['d3', 'd4']);
    expect((await run({ amountFrom: '5000', amountTo: '5000.00' })).keys).toEqual(['d2', 'd4']);
    expect((await run({ amountTo: '1000' })).keys).toEqual(['d1', 'd3']);
    expect((await run({ amountFrom: '0' })).keys).not.toContain('dateOnly');
    expect((await run({ amountFrom: '0' })).keys).not.toContain('none');
  });

  it('AC-1 no criteria: every row of the company, txnDate desc (empty dates first) then newest; limit/offset pages', async () => {
    const all = await search(inCo(), {});
    expect(all.total).toBe(8);
    expect(all.limit).toBe(50);
    expect(all.offset).toBe(0);
    const order = keysOf(all);
    expect(order.slice(0, 1)).toEqual(['none']); // PostgreSQL puts NULL first in DESC order
    expect(order.slice(1)).toEqual(['d5', 'd4', 'd3', 'd2', 'd6', 'dateOnly', 'd1']);
    const page = await search(inCo(), { limit: 3, offset: 3 });
    expect(keysOf(page)).toEqual(['d3', 'd2', 'd6']);
    expect(page).toMatchObject({ total: 8, limit: 3, offset: 3 });
  });

  it('AC-3 rows carry the public fields (no storage key), the amount as a decimal string and the incomplete flag', async () => {
    const res = await run({});
    const d1 = res.res.items.find((i) => i.id === ids.d1);
    expect(d1).toMatchObject({
      amount: '1000',
      txnDate: '2025-01-10',
      partnerId: p1,
      incomplete: false,
      supersedes: 0,
    });
    expect(d1).not.toHaveProperty('storageKey');
    expect(d1?.linked).toBeNull();
    expect(res.res.items.find((i) => i.id === ids.dateOnly)?.incomplete).toBe(true);
    expect(res.res.items.find((i) => i.id === ids.none)?.incomplete).toBe(true);
  });

  it('AC-4 incomplete: true returns only rows missing a key (ANDed with the rest); false is no filter', async () => {
    expect((await run({ incomplete: true })).keys).toEqual(['dateOnly', 'none']);
    expect((await run({ incomplete: true, ...JAN })).keys).toEqual(['dateOnly']);
    expect((await run({ incomplete: false })).total).toBe(8);
  });
});

describe('supersede filters, counts and the link summary limits (AC-3, AC-4, AC-5)', () => {
  let company: string;
  const inCo = () => ({ companyId: company });

  beforeAll(async () => {
    company = await newCompany('EV-SUP');
  });

  it('AC-4 superseded include/exclude/only; AC-3 supersedes counts direct older versions (2 for a merge)', async () => {
    const v1 = await db.run(inCo(), (ctx) => upload(ctx, { kind: 'invoice_received' }));
    const v2 = await db.run(inCo(), (ctx) => upload(ctx, { kind: 'invoice_received' }));
    const v3 = await db.run(inCo(), (ctx) => upload(ctx, { kind: 'invoice_received' }));
    const lone = await db.run(inCo(), (ctx) => upload(ctx, { kind: 'invoice_received' }));
    await supersede(inCo(), v1.id, v3.id, 'v1 誤り');
    await supersede(inCo(), v2.id, v3.id, 'v2 誤り');
    const ids = (res: SearchResult) => res.items.map((i) => i.id).sort();
    const base = { kind: 'invoice_received' };
    expect(ids(await search(inCo(), base))).toEqual([v1.id, v2.id, v3.id, lone.id].sort());
    expect(ids(await search(inCo(), { ...base, superseded: 'include' }))).toEqual(
      [v1.id, v2.id, v3.id, lone.id].sort(),
    );
    expect(ids(await search(inCo(), { ...base, superseded: 'exclude' }))).toEqual([v3.id, lone.id].sort());
    expect(ids(await search(inCo(), { ...base, superseded: 'only' }))).toEqual([v1.id, v2.id].sort());
    const all = await search(inCo(), base);
    const byId = new Map(all.items.map((i) => [i.id, i]));
    expect(byId.get(v3.id)?.supersedes).toBe(2);
    expect(byId.get(v1.id)).toMatchObject({ supersedes: 0, supersededById: v3.id });
    expect(byId.get(lone.id)?.supersedes).toBe(0);
  });

  it('AC-5 a page of 60 rows linked to 60 different records of one entity: every link is read (no default limit of 50)', async () => {
    const partners: string[] = [];
    for (let i = 0; i < 60; i++)
      partners.push((await db.run(inCo(), (ctx) => repo(ctx, Partner).create({ name: `リンク先 ${i}` }))).id);
    for (const [i, partnerId] of partners.entries())
      await db.run(inCo(), (ctx) =>
        upload(ctx, { kind: 'contract', linkedEntity: 'partner', linkedId: partnerId }, `link-${i}.pdf`),
      );
    const res = await search(inCo(), { kind: 'contract', limit: 100 });
    expect(res.total).toBe(60);
    expect(res.items).toHaveLength(60);
    expect(res.items.every((i) => i.linked?.readable === true)).toBe(true);
    const names = new Set(res.items.map((i) => i.linked?.title));
    expect(names.size).toBe(60);
    const first = res.items.find((i) => i.filename === 'link-0.pdf');
    expect(first?.linked).toEqual({
      entity: 'partner',
      id: partners[0],
      kind: 'entity',
      readable: true,
      target: { entity: 'partner', id: partners[0] },
      title: 'リンク先 0',
      number: null,
      docstatus: null,
    });
  });

  it('AC-5 a deleted target, a target of another company and an unregistered entity are readable: false with nothing else', async () => {
    const gone = (await db.run(inCo(), (ctx) => repo(ctx, Partner).create({ name: '削除される取引先' }))).id;
    const a = await db.run(inCo(), (ctx) =>
      upload(ctx, { kind: 'bank_statement', linkedEntity: 'partner', linkedId: gone }),
    );
    await db.run(inCo(), (ctx) => repo(ctx, Partner).delete(gone));
    // Links the write path would refuse (another company, an unregistered entity) — set directly as legacy data would be.
    const other = await newCompany('EV-SUP-B');
    const foreign = (await db.run({ companyId: other }, (ctx) => repo(ctx, Partner).create({ name: '他社の取引先' })))
      .id;
    const b = await db.run(inCo(), (ctx) => upload(ctx, { kind: 'bank_statement' }));
    const c = await db.run(inCo(), (ctx) => upload(ctx, { kind: 'bank_statement' }));
    await db.owner.sql`update attachment set linked_entity = 'partner', linked_id = ${foreign} where id = ${b.id}`;
    await db.owner
      .sql`update attachment set linked_entity = 'no_such_entity', linked_id = ${newId()} where id = ${c.id}`;
    const res = await search(inCo(), { kind: 'bank_statement' });
    const linked = Object.fromEntries(res.items.map((i) => [i.id, i.linked]));
    expect(linked[a.id]).toEqual({
      entity: 'partner',
      id: gone,
      kind: 'entity',
      readable: false,
      target: null,
      title: null,
      number: null,
      docstatus: null,
    });
    expect(linked[b.id]).toMatchObject({
      entity: 'partner',
      id: foreign,
      kind: 'entity',
      readable: false,
      title: null,
    });
    expect(linked[c.id]).toMatchObject({ entity: 'no_such_entity', kind: 'unknown', readable: false, target: null });
  });
});

describe('attachment.history: the supersede tree (AC-10)', () => {
  let company: string;
  const inCo = () => ({ companyId: company });
  const summary = (res: { items: HistoryItem[] }) => res.items.map((i) => [i.id, i.relation, i.depth]);

  beforeAll(async () => {
    company = await newCompany('EV-HIS');
  });

  it('AC-10 a chain v1 -> v2 -> v3 from each end: relations, depth, order, reason/time/actor, old files readable', async () => {
    const v1 = await db.run(inCo(), (ctx) => upload(ctx));
    const v2 = await db.run(inCo(), (ctx) => upload(ctx));
    const v3 = await db.run(inCo(), (ctx) => upload(ctx));
    const acc = asRole(['accounting'], inCo());
    await supersede(acc, v1.id, v2.id, '金額誤り');
    await supersede(acc, v2.id, v3.id, '取引先誤り');
    const fromV1 = await history(asRole(['viewer'], inCo()), v1.id);
    expect(fromV1.id).toBe(v1.id);
    expect(fromV1.truncated).toBe(false);
    expect(summary(fromV1)).toEqual([
      [v3.id, 'newer', 0],
      [v2.id, 'newer', 1],
      [v1.id, 'self', 2],
    ]);
    const [h3, h2, h1] = fromV1.items;
    expect(h3?.supersede).toBeNull();
    expect(h2?.supersede).toMatchObject({ reason: '取引先誤り', actorType: 'user', actorId: acc.actor.id });
    expect(h1?.supersede).toMatchObject({ reason: '金額誤り', actorType: 'user', actorId: acc.actor.id });
    expect(Number.isNaN(Date.parse(h1?.supersede?.at ?? ''))).toBe(false);
    expect(h1).not.toHaveProperty('storageKey');
    expect(summary(await history(inCo(), v3.id))).toEqual([
      [v3.id, 'self', 0],
      [v2.id, 'older', 1],
      [v1.id, 'older', 2],
    ]);
    // AC-8 (attachments): the superseded version and its bytes are still there
    const bytes = await db.run(asRole(['viewer'], inCo()), async (ctx) => {
      const row = await repo(ctx, Attachment).get(v1.id);
      return (await ctx.storage.get(row.storageKey)).byteLength;
    });
    expect(bytes).toBe(v1.size);
  });

  it('AC-10 a branch a -> c and b -> c: from a, b is a sibling; same-depth rows newest first', async () => {
    const a = await db.run(inCo(), (ctx) => upload(ctx));
    const b = await db.run(inCo(), (ctx) => upload(ctx));
    const c = await db.run(inCo(), (ctx) => upload(ctx));
    const a0 = await db.run(inCo(), (ctx) => upload(ctx));
    // a replacement must be current, so a0 -> a goes first
    await supersede(inCo(), a0.id, a.id, 'a0 を a に');
    await supersede(inCo(), a.id, c.id, 'a を c に');
    await supersede(inCo(), b.id, c.id, 'b を c に');
    // b was registered after a, so it comes first among the depth-1 rows
    expect(summary(await history(inCo(), a.id))).toEqual([
      [c.id, 'newer', 0],
      [b.id, 'sibling', 1],
      [a.id, 'self', 1],
      [a0.id, 'older', 2],
    ]);
    expect(summary(await history(inCo(), b.id))).toEqual([
      [c.id, 'newer', 0],
      [b.id, 'self', 1],
      [a.id, 'sibling', 1],
      [a0.id, 'sibling', 2],
    ]);
  });

  it('AC-10 a superseded row without its supersede audit entry shows the record as null ("not recorded")', async () => {
    const old = await db.run(inCo(), (ctx) => upload(ctx));
    const current = await db.run(inCo(), (ctx) => upload(ctx));
    // The trusted write capability without attachment.supersede: what migrated data looks like (no reason recorded).
    await db.run(inCo(), (ctx) =>
      withSupersede(ctx, (internal) => repo(internal, Attachment).update(old.id, { supersededById: current.id })),
    );
    const res = await history(inCo(), old.id);
    expect(summary(res)).toEqual([
      [current.id, 'newer', 0],
      [old.id, 'self', 1],
    ]);
    expect(res.items[1]?.supersede).toEqual({ reason: null, at: null, actorType: null, actorId: null });
    // later generic updates of the superseded row do not hide an existing supersede entry
    const x = await db.run(inCo(), (ctx) => upload(ctx));
    const y = await db.run(inCo(), (ctx) => upload(ctx));
    await supersede(inCo(), x.id, y.id, '差替理由');
    for (let i = 0; i < 3; i++)
      await db.run(inCo(), async (ctx) => {
        const row = await repo(ctx, Attachment).get(x.id);
        await repo(ctx, Attachment).update(x.id, { note: `更新 ${i}` }, { expectedVersion: row.version });
      });
    expect((await history(inCo(), x.id)).items[1]?.supersede?.reason).toBe('差替理由');
  });

  it('AC-10 a row 51 versions below the latest keeps itself and the whole path; a sibling beyond the budget sets truncated', async () => {
    const chain: AttachmentRow[] = [];
    for (let i = 0; i < 52; i++) chain.push(await db.run(inCo(), (ctx) => upload(ctx)));
    for (let i = 0; i < 51; i++)
      await supersede(inCo(), (chain[i] as AttachmentRow).id, (chain[i + 1] as AttachmentRow).id, `段 ${i}`);
    const latest = chain[51] as AttachmentRow;
    const side = await db.run(inCo(), (ctx) => upload(ctx));
    await supersede(inCo(), side.id, latest.id, '分岐');
    const deep = await history(inCo(), (chain[0] as AttachmentRow).id);
    expect(deep.truncated).toBe(true);
    expect(deep.items).toHaveLength(52);
    expect(deep.items[0]).toMatchObject({ id: latest.id, relation: 'newer', depth: 0 });
    expect(deep.items[51]).toMatchObject({ id: chain[0]?.id, relation: 'self', depth: 51 });
    expect(deep.items.map((i) => i.id)).not.toContain(side.id);
    // from the latest: 50 rows breadth-first, the rest left out
    const top = await history(inCo(), latest.id);
    expect(top.items).toHaveLength(50);
    expect(top.truncated).toBe(true);
    expect(top.items.slice(0, 3).map((i) => i.relation)).toEqual(['self', 'older', 'older']);
  });
});

describe('company isolation, permissions and validation (AC-7, AC-8, AC-9)', () => {
  let companyA: string;
  let companyB: string;
  let rowA: AttachmentRow;
  let rowB: AttachmentRow;
  let partnerB: string;

  beforeAll(async () => {
    companyA = await newCompany('EV-ISO-A');
    companyB = await newCompany('EV-ISO-B');
    const partnerA = (await db.run({ companyId: companyA }, (ctx) => repo(ctx, Partner).create({ name: '同名取引先' })))
      .id;
    partnerB = (await db.run({ companyId: companyB }, (ctx) => repo(ctx, Partner).create({ name: '同名取引先' }))).id;
    const same = { txnDate: '2026-05-01', amount: '7777', kind: 'receipt' };
    rowA = await db.run({ companyId: companyA }, (ctx) => upload(ctx, { ...same, partnerId: partnerA }, 'same.pdf'));
    rowB = await db.run({ companyId: companyB }, (ctx) => upload(ctx, { ...same, partnerId: partnerB }, 'same.pdf'));
  });

  it("AC-7 another company's identical evidence is neither returned nor counted; its partner id finds nothing; its id is NotFound", async () => {
    const res = await search(
      { companyId: companyA },
      { txnDateFrom: '2026-05-01', txnDateTo: '2026-05-01', amountFrom: '7777', amountTo: '7777' },
    );
    expect(res.items.map((i) => i.id)).toEqual([rowA.id]);
    expect(res.total).toBe(1);
    expect((await search({ companyId: companyA }, {})).items.map((i) => i.id)).not.toContain(rowB.id);
    expect(await search({ companyId: companyA }, { partnerId: partnerB })).toMatchObject({ items: [], total: 0 });
    await expect(history({ companyId: companyA }, rowB.id)).rejects.toBeInstanceOf(NotFound);
    expect((await history({ companyId: companyB }, rowB.id)).items.map((i) => i.id)).toEqual([rowB.id]);
  });

  it('AC-8 callers without attachment read, or limited to stores or sites, are refused; viewer may search', async () => {
    const co = { companyId: companyA };
    await expect(search(asRole(['nobody'], co), {})).rejects.toBeInstanceOf(PermissionDenied);
    await expect(history(asRole(['nobody'], co), rowA.id)).rejects.toBeInstanceOf(PermissionDenied);
    const limited = [
      { accessScope: 'stores' as const, storeIds: [newId()] },
      { accessScope: 'sites' as const, siteIds: [newId()] },
    ];
    for (const scope of limited) {
      const scoped = asRole(['accounting'], { ...co, ...scope });
      await expect(search(scoped, {}), scope.accessScope).rejects.toBeInstanceOf(PermissionDenied);
      await expect(history(scoped, rowA.id), scope.accessScope).rejects.toBeInstanceOf(PermissionDenied);
    }
    for (const role of ['viewer', 'accounting', 'sales', 'purchasing'])
      expect((await search(asRole([role], co), {})).items.map((i) => i.id)).toContain(rowA.id);
  });

  it('AC-9 invalid input is a ValidationError naming the input', async () => {
    const co = { companyId: companyA };
    const cases: [Record<string, unknown>, string][] = [
      [{ txnDateFrom: '2026-02-01', txnDateTo: '2026-01-01' }, 'txnDateFrom'],
      [{ txnDateFrom: '2026-02-30' }, 'txnDateFrom'],
      [{ txnDateTo: '20260101' }, 'txnDateTo'],
      [{ amountFrom: 'abc' }, 'amountFrom'],
      [{ amountTo: '1,000' }, 'amountTo'],
      [{ amountFrom: '10', amountTo: '9' }, 'amountFrom'],
      [{ kind: 'nope' }, 'kind'],
      [{ superseded: 'latest' }, 'superseded'],
      [{ limit: 101 }, 'limit'],
      [{ limit: 0 }, 'limit'],
      [{ offset: -1 }, 'offset'],
    ];
    for (const [input, path] of cases)
      await expect(search(co, input), JSON.stringify(input)).rejects.toMatchObject({
        code: 'VALIDATION',
        details: { issues: [{ path }] },
      });
    await expect(history(co, 'not-a-uuid')).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'id' }] },
    });
    await expect(history(co, newId())).rejects.toBeInstanceOf(NotFound);
  });
});
