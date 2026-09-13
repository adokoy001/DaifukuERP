import {
  auditTrail,
  Conflict,
  configureStorage,
  LocalStorage,
  NotFound,
  PermissionDenied,
  StateError,
  ValidationError,
  appMeta,
  newId,
  registerCrudActions,
  repo,
  runAction,
  systemParams,
  withContext,
  type Context,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Partner } from '@daifuku/mod-partner';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Attachment, AttachmentsModule, uploadAttachment, type AttachmentRow } from '../src/index.ts';

let db: TestDb;
let partnerA: string;
let partnerB: string;
let partnerC: string;
let seq = 0;

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  configureStorage(new LocalStorage(await mkdtemp(join(tmpdir(), 'daifuku-attachments-'))));
  partnerA = (await db.run({}, (ctx) => repo(ctx, Partner).create({ name: 'Partner A' }))).id;
  partnerB = (await db.run({}, (ctx) => repo(ctx, Partner).create({ name: 'Partner B' }))).id;
  partnerC = (await db.run({}, (ctx) => repo(ctx, Partner).create({ name: 'Partner C' }))).id;
});
afterAll(async () => {
  await db.close();
});

const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
const bytes = (s: string) => new TextEncoder().encode(s);

/** Uploads unique content unless `content` is given. */
function upload(
  ctx: Context,
  fields: Record<string, string | undefined> = {},
  opts: { content?: string; filename?: string; contentType?: string } = {},
): Promise<AttachmentRow> {
  seq += 1;
  return uploadAttachment(ctx, {
    data: bytes(opts.content ?? `evidence #${seq}`),
    filename: opts.filename ?? `file-${seq}.pdf`,
    contentType: opts.contentType ?? 'application/pdf',
    fields,
  });
}

describe('attachment entity (docs/specs/attachments.md)', () => {
  it('AC-1 fields, defaults, immutability and the module manifest', async () => {
    expect(AttachmentsModule.depends).toEqual(['partner']);
    expect(AttachmentsModule.actions?.map((a) => a.name)).toEqual([
      'attachment.search',
      'attachment.supersede',
      'attachment.link',
      'attachment.for_record',
    ]);
    expect(Attachment.fieldNames).toEqual([
      'storageKey',
      'filename',
      'contentType',
      'size',
      'sha256',
      'kind',
      'txnDate',
      'amount',
      'partnerId',
      'linkedEntity',
      'linkedId',
      'note',
      'supersededById',
    ]);
    const a = await db.run({}, (ctx) => upload(ctx));
    expect(a).toMatchObject({
      kind: 'other',
      txnDate: null,
      amount: null,
      partnerId: null,
      linkedEntity: null,
      linkedId: null,
      note: null,
      supersededById: null,
      version: 1,
    });
    expect(a.companyId).toBe(db.companyId);
    for (const patch of [{ storageKey: 'x/y' }, { sha256: 'a'.repeat(64) }]) {
      const err = await db.run({}, (ctx) => repo(ctx, Attachment).update(a.id, patch)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PermissionDenied);
    }
    await expect(
      db.run({}, (ctx) =>
        repo(ctx, Attachment).create({
          storageKey: 'k',
          filename: 'f',
          contentType: 'text/plain',
          size: 1,
          sha256: 'not-hex',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('AC-1 permissions: accounting/sales/purchasing read+create+update, viewer read, nobody denied; delete is denied to every role and refused for admin', async () => {
    const target = await db.run({}, (ctx) => upload(ctx));
    for (const role of ['accounting', 'sales', 'purchasing']) {
      const own = await db.run(asRole([role]), (ctx) => upload(ctx));
      const updated = await db.run(asRole([role]), (ctx) =>
        repo(ctx, Attachment).update(own.id, { note: `by ${role}` }),
      );
      expect(updated.version).toBe(2);
      await expect(db.run(asRole([role]), (ctx) => repo(ctx, Attachment).delete(own.id))).rejects.toBeInstanceOf(
        PermissionDenied,
      );
      const ops = await db.run(
        asRole([role]),
        async (ctx) => appMeta(ctx).entities.find((e) => e.name === 'attachment')?.ops,
      );
      expect(ops).toEqual(['read', 'create', 'update']);
    }
    const viewer = asRole(['viewer']);
    expect((await db.run(viewer, (ctx) => repo(ctx, Attachment).get(target.id))).id).toBe(target.id);
    await expect(db.run(viewer, (ctx) => upload(ctx))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      db.run(viewer, (ctx) => repo(ctx, Attachment).update(target.id, { note: 'x' })),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(db.run(asRole(['nobody']), (ctx) => repo(ctx, Attachment).list())).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    // admin implicitly holds every op, so the before_delete hook is what keeps evidence undeletable (電帳法)
    const err = await db
      .run({}, (ctx) => runAction(ctx, 'attachment.delete', { id: target.id }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StateError);
    expect((err as StateError).hint).toContain('supersede');
    expect((await db.run({}, (ctx) => repo(ctx, Attachment).get(target.id))).id).toBe(target.id);
  });

  it('AC-2 uploadAttachment stores the bytes through ctx.storage, records size/sha256/normalised type and the metadata fields', async () => {
    const a = await db.run({}, (ctx) =>
      upload(
        ctx,
        {
          kind: 'receipt',
          txnDate: '2026-04-01',
          amount: '1234.50',
          partnerId: partnerC,
          note: ' タクシー代 ',
          linkedEntity: '',
          linkedId: '',
        },
        { content: '領収書', filename: 'up/領収書.PDF', contentType: 'Application/PDF; charset=binary' },
      ),
    );
    expect(a).toMatchObject({
      filename: '領収書.PDF',
      contentType: 'application/pdf',
      size: bytes('領収書').byteLength,
      kind: 'receipt',
      txnDate: '2026-04-01',
      partnerId: partnerC,
      note: 'タクシー代',
      linkedEntity: null,
    });
    expect(a.amount?.toString()).toBe('1234.5');
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.storageKey.startsWith(`${db.tenantId}/`)).toBe(true);
    const back = await db.run({}, (ctx) => ctx.storage.get(a.storageKey));
    expect(new TextDecoder().decode(back)).toBe('領収書');
    const stored = await db.run({}, (ctx) =>
      ctx.storage.put(ctx.tenantId, bytes('領収書'), { filename: 'x', contentType: 'x' }),
    );
    expect(stored.sha256).toBe(a.sha256); // same digest as the storage port computes
  });

  it('AC-2 rejects bad content types, empty files, invalid fields and invisible refs before anything is stored', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'daifuku-attachments-count-'));
    configureStorage(new LocalStorage(dir));
    const cases: {
      fields?: Record<string, string>;
      opts?: { content?: string; contentType?: string };
      error: new (...args: never[]) => unknown;
      path?: string;
    }[] = [
      { opts: { contentType: 'application/zip' }, error: ValidationError, path: 'file.contentType' },
      { opts: { content: '' }, error: ValidationError, path: 'file' },
      { fields: { kind: 'selfie' }, error: ValidationError, path: 'kind' },
      { fields: { txnDate: '2026-13-01' }, error: ValidationError, path: 'txnDate' },
      { fields: { amount: 'abc' }, error: ValidationError, path: 'amount' },
      { fields: { partnerId: 'nope' }, error: ValidationError, path: 'partnerId' },
      { fields: { linkedEntity: 'partner' }, error: ValidationError, path: 'linkedId' },
      { fields: { linkedEntity: 'nope', linkedId: newId() }, error: ValidationError, path: 'entity' },
      { fields: { partnerId: newId() }, error: NotFound },
      { fields: { linkedEntity: 'partner', linkedId: newId() }, error: NotFound },
    ];
    for (const c of cases) {
      const err = await db.run({}, (ctx) => upload(ctx, c.fields, c.opts)).catch((e: unknown) => e);
      expect(err, JSON.stringify(c)).toBeInstanceOf(c.error);
      if (c.path) expect((err as ValidationError).details).toMatchObject({ issues: [{ path: c.path }] });
    }
    expect(await readdir(dir)).toEqual([]); // nothing reached the store
  });

  it('AC-7 the same bytes twice in one company is a Conflict naming the existing id; another company may store them', async () => {
    const first = await db.run({}, (ctx) => upload(ctx, {}, { content: 'dup-bytes' }));
    const err = await db
      .run({}, (ctx) => upload(ctx, {}, { content: 'dup-bytes', filename: 'other-name.pdf' }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Conflict);
    expect((err as Conflict).details).toEqual({ existingId: first.id, sha256: first.sha256 });
    // Generic create cannot impersonate the trusted upload path.
    const viaCreate = await db
      .run({}, (ctx) =>
        runAction(ctx, 'attachment.create', {
          storageKey: 'k/k',
          filename: 'f',
          contentType: 'text/plain',
          size: 9,
          sha256: first.sha256,
        }),
      )
      .catch((e: unknown) => e);
    expect(viaCreate).toBeInstanceOf(PermissionDenied);
    const otherCompany = newId();
    await db.owner
      .sql`insert into companies (id, tenant_id, code, name) values (${otherCompany}, ${db.tenantId}, 'T2', 'Second Co')`;
    const second = await withContext(db.app, systemParams(db.tenantId, otherCompany), (ctx) =>
      upload(ctx, {}, { content: 'dup-bytes' }),
    );
    expect(second.sha256).toBe(first.sha256);
    expect(second.companyId).toBe(otherCompany);
  });
});

describe('attachment.search (AC-4)', () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const rows: [string, Record<string, string>][] = [
      ['jan-a-1000', { txnDate: '2026-01-15', amount: '1000', partnerId: partnerA, kind: 'invoice_received' }],
      ['feb-a-2500', { txnDate: '2026-02-10', amount: '2500', partnerId: partnerA, kind: 'receipt' }],
      ['feb-b-2500', { txnDate: '2026-02-20', amount: '2500', partnerId: partnerB, kind: 'receipt' }],
      ['mar-b-9999', { txnDate: '2026-03-31', amount: '9999.99', partnerId: partnerB, kind: 'contract' }],
      ['none', {}],
    ];
    for (const [key, fields] of rows)
      ids[key] = (await db.run({}, (ctx) => upload(ctx, fields, { content: `search ${key}` }))).id;
  });

  const search = async (input: Record<string, unknown>, roles?: string[]) => {
    const res = (await db.run(roles ? asRole(roles) : {}, (ctx) => runAction(ctx, 'attachment.search', input))) as {
      items: { id: string; amount: string | null }[];
      total: number;
    };
    const keys = res.items.map((i) => Object.entries(ids).find(([, id]) => id === i.id)?.[0] ?? `?${i.id}`);
    return { keys, total: res.total, items: res.items };
  };

  it('filters by date range, amount range, partner and kind, and by their combination', async () => {
    expect((await search({ txnDateFrom: '2026-02-01', txnDateTo: '2026-02-28' })).keys.sort()).toEqual([
      'feb-a-2500',
      'feb-b-2500',
    ]);
    expect((await search({ txnDateFrom: '2026-03-01', txnDateTo: '2026-03-31' })).keys).toEqual(['mar-b-9999']);
    expect((await search({ txnDateTo: '2026-01-31' })).keys).toEqual(['jan-a-1000']);
    expect((await search({ amountFrom: '2500', amountTo: '2500.00' })).keys.sort()).toEqual([
      'feb-a-2500',
      'feb-b-2500',
    ]);
    expect((await search({ amountFrom: '2500.01' })).keys).toEqual(['mar-b-9999']);
    expect((await search({ partnerId: partnerA })).keys.sort()).toEqual(['feb-a-2500', 'jan-a-1000']);
    expect((await search({ kind: 'receipt', partnerId: partnerB })).keys).toEqual(['feb-b-2500']);
    expect(
      (
        await search({
          txnDateFrom: '2026-01-01',
          txnDateTo: '2026-12-31',
          amountFrom: '1000',
          amountTo: '3000',
          partnerId: partnerA,
          kind: 'receipt',
        })
      ).keys,
    ).toEqual(['feb-a-2500']);
    expect((await search({ txnDateFrom: '2026-01-01', kind: 'bank_statement' })).total).toBe(0);
    const all = await search({});
    expect(all.total).toBeGreaterThanOrEqual(5);
    expect(all.items.find((i) => i.id === ids['feb-a-2500'])?.amount).toBe('2500');
  });

  it('orders by txnDate desc and paginates; validates input; requires attachment read', async () => {
    const page = await search({ txnDateFrom: '2026-01-01', txnDateTo: '2026-03-31', limit: 2, offset: 1 });
    expect(page.keys).toEqual(['feb-b-2500', 'feb-a-2500']);
    expect(page.total).toBe(4);
    await expect(search({ txnDateFrom: '2026-02-01', txnDateTo: '2026-01-01' })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'txnDateFrom' }] },
    });
    await expect(search({ amountFrom: 'x' })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'amountFrom' }] },
    });
    await expect(search({ kind: 'nope' })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'kind' }] },
    });
    expect((await search({ partnerId: partnerB }, ['viewer'])).keys.sort()).toEqual(['feb-b-2500', 'mar-b-9999']);
    await expect(search({}, ['nobody'])).rejects.toBeInstanceOf(PermissionDenied);
  });
});

describe('attachment.supersede (AC-5, AC-8)', () => {
  it('records the replacement and the reason in the audit trail; the old file stays retrievable; history is write-once and acyclic', async () => {
    const v1 = await db.run({}, (ctx) => upload(ctx, { kind: 'invoice_received' }, { content: 'invoice v1' }));
    const v2 = await db.run({}, (ctx) => upload(ctx, { kind: 'invoice_received' }, { content: 'invoice v2' }));
    const v3 = await db.run({}, (ctx) => upload(ctx, { kind: 'invoice_received' }, { content: 'invoice v3' }));
    const acc = asRole(['accounting']);
    const old = (await db.run(acc, (ctx) =>
      runAction(ctx, 'attachment.supersede', { id: v1.id, newAttachmentId: v2.id, reason: '金額誤り' }),
    )) as { supersededById: string; version: number };
    expect(old).toMatchObject({ supersededById: v2.id, version: 2 });
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'attachment', v1.id));
    expect(trail.map((e) => e.op).sort()).toEqual(['create', 'supersede', 'update']);
    expect(trail.find((e) => e.op === 'supersede')).toMatchObject({
      action: 'attachment.supersede',
      actorType: 'user',
      actorId: acc.actor.id,
      before: { supersededById: null },
      after: { supersededById: v2.id, reason: '金額誤り' },
    });
    expect(trail.find((e) => e.op === 'update')).toMatchObject({
      before: { supersededById: null },
      after: { supersededById: v2.id },
    });
    // AC-8: the superseded row and its bytes are still readable
    const again = await db.run(asRole(['viewer']), async (ctx) => {
      const row = await repo(ctx, Attachment).get(v1.id);
      return new TextDecoder().decode(await ctx.storage.get(row.storageKey));
    });
    expect(again).toBe('invoice v1');
    // write-once, no self, replacement must be current, no clearing, and the reason is required
    await expect(
      db.run(acc, (ctx) =>
        runAction(ctx, 'attachment.supersede', { id: v1.id, newAttachmentId: v3.id, reason: 'again' }),
      ),
    ).rejects.toBeInstanceOf(StateError);
    await expect(
      db.run(acc, (ctx) =>
        runAction(ctx, 'attachment.supersede', { id: v3.id, newAttachmentId: v3.id, reason: 'self' }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      db.run(acc, (ctx) =>
        runAction(ctx, 'attachment.supersede', { id: v3.id, newAttachmentId: v1.id, reason: 'cycle' }),
      ),
    ).rejects.toBeInstanceOf(StateError);
    await expect(
      db.run(acc, (ctx) =>
        runAction(ctx, 'attachment.supersede', { id: v2.id, newAttachmentId: newId(), reason: 'ghost' }),
      ),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      db.run(acc, (ctx) => runAction(ctx, 'attachment.supersede', { id: v2.id, newAttachmentId: v3.id, reason: '  ' })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      db.run({}, (ctx) => repo(ctx, Attachment).update(v1.id, { supersededById: null })),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      db.run({}, (ctx) => repo(ctx, Attachment).update(v1.id, { supersededById: v3.id })),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      db.run({}, (ctx) =>
        repo(ctx, Attachment).create({
          storageKey: 'k/s',
          filename: 'f',
          contentType: 'text/plain',
          size: 1,
          sha256: 'b'.repeat(64),
          supersededById: v3.id,
        }),
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    // chain: v2 -> v3 is fine (v3 is current); viewer may not supersede
    expect(
      (
        (await db.run(acc, (ctx) =>
          runAction(ctx, 'attachment.supersede', { id: v2.id, newAttachmentId: v3.id, reason: 'v3' }),
        )) as { supersededById: string }
      ).supersededById,
    ).toBe(v3.id);
    await expect(
      db.run(asRole(['viewer']), (ctx) =>
        runAction(ctx, 'attachment.supersede', { id: v3.id, newAttachmentId: v2.id, reason: 'x' }),
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});

describe('attachment.link / for_record (AC-6)', () => {
  it('links to a visible record of a registered entity and lists attachments of that record', async () => {
    const a = await db.run({}, (ctx) => upload(ctx));
    const b = await db.run({}, (ctx) => upload(ctx));
    const linked = (await db.run(asRole(['sales']), (ctx) =>
      runAction(ctx, 'attachment.link', { id: a.id, entity: 'partner', recordId: partnerA }),
    )) as { linkedEntity: string; linkedId: string };
    expect(linked).toMatchObject({ linkedEntity: 'partner', linkedId: partnerA });
    await db.run({}, (ctx) => runAction(ctx, 'attachment.link', { id: b.id, entity: 'partner', recordId: partnerA }));
    const list = (await db.run(asRole(['viewer']), (ctx) =>
      runAction(ctx, 'attachment.for_record', { entity: 'partner', recordId: partnerA }),
    )) as { items: { id: string }[]; total: number };
    expect(list.total).toBe(2);
    expect(list.items.map((i) => i.id)).toEqual([b.id, a.id]); // newest first
    expect(
      (
        (await db.run({}, (ctx) =>
          runAction(ctx, 'attachment.for_record', { entity: 'partner', recordId: partnerB }),
        )) as { total: number }
      ).total,
    ).toBe(0);
    // an attachment can be re-linked, and linked to an attachment (any registered entity)
    const relinked = (await db.run({}, (ctx) =>
      runAction(ctx, 'attachment.link', { id: a.id, entity: 'attachment', recordId: b.id }),
    )) as { linkedEntity: string };
    expect(relinked.linkedEntity).toBe('attachment');
  });

  it('rejects unknown entities, invisible records and callers without update/read', async () => {
    const a = await db.run({}, (ctx) => upload(ctx));
    for (const name of ['attachment.link', 'attachment.for_record']) {
      const input =
        name === 'attachment.link'
          ? { id: a.id, entity: 'nope', recordId: partnerA }
          : { entity: 'nope', recordId: partnerA };
      await expect(db.run({}, (ctx) => runAction(ctx, name, input))).rejects.toMatchObject({
        code: 'VALIDATION',
        details: { issues: [{ path: 'entity' }] },
      });
    }
    await expect(
      db.run({}, (ctx) => runAction(ctx, 'attachment.link', { id: a.id, entity: 'partner', recordId: newId() })),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      db.run({}, (ctx) => runAction(ctx, 'attachment.for_record', { entity: 'partner', recordId: newId() })),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      db.run({}, (ctx) => runAction(ctx, 'attachment.link', { id: newId(), entity: 'partner', recordId: partnerA })),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      db.run(asRole(['viewer']), (ctx) =>
        runAction(ctx, 'attachment.link', { id: a.id, entity: 'partner', recordId: partnerA }),
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      db.run(asRole(['nobody']), (ctx) =>
        runAction(ctx, 'attachment.for_record', { entity: 'partner', recordId: partnerA }),
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    // the generic update path is guarded by the same hook
    await expect(
      db.run({}, (ctx) => repo(ctx, Attachment).update(a.id, { linkedEntity: 'partner' })),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'linkedId' }] } });
    await expect(
      db.run({}, (ctx) => repo(ctx, Attachment).update(a.id, { linkedEntity: 'partner', linkedId: newId() })),
    ).rejects.toBeInstanceOf(NotFound);
  });
});
