// docs/specs/attachments.md AC-8: AC-1..7 through the API (fastify inject with multipart) and the actions.
// The module is imported before server.ts so registerCrudActions() (run by modules.ts at import) also derives
// attachment.list/get/...; server.ts/modules.ts are wired by the orchestrator, so the routes are attached here.
import { AttachmentsModule } from '@daifuku/mod-attachments';
import {
  auditTrail,
  bootstrapTenant,
  companyMemberships,
  configureStorage,
  hashPassword,
  LocalStorage,
  newId,
  registerCrudActions,
  users,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentDisposition, registerAttachmentRoutes } from '../src/routes/attachments.ts';
import { buildServer } from '../src/server.ts';

const JWT_SECRET = 'test-secret';

let db: TestDb;
let app: FastifyInstance;
let token: string;
let salesToken: string;
let viewerToken: string;
let nobodyToken: string;
let partnerId: string;
let seq = 0;

interface JsonResponse {
  status: number;
  body: Record<string, unknown> & {
    error?: { code: string; message: string; hint: string; details?: Record<string, unknown> };
  };
}

type Part = { name: string; value: string } | { name: string; filename: string; contentType: string; data: Uint8Array };

/** Hand-rolled multipart/form-data body (what curl -F / a browser form sends). */
function multipart(parts: Part[]): { payload: Buffer; contentType: string } {
  const boundary = `----daifuku-${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if ('data' in p) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\nContent-Type: ${p.contentType}\r\n\r\n`,
        ),
      );
      chunks.push(Buffer.from(p.data), Buffer.from('\r\n'));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  opts: { body?: unknown; token?: string | null; headers?: Record<string, string> } = {},
): Promise<JsonResponse> {
  const t = opts.token === undefined ? token : opts.token;
  const res = await app.inject({
    method,
    url,
    headers: {
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...opts.headers,
    },
    ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
  });
  return { status: res.statusCode, body: res.json() as JsonResponse['body'] };
}

interface UploadOpts {
  content?: string | Uint8Array;
  filename?: string;
  contentType?: string;
  fields?: Record<string, string>;
  token?: string | null;
  headers?: Record<string, string>;
  /** Parts before the file (form field order matters to busboy; both orders must work). */
  fieldsFirst?: boolean;
}

/** Uploads unique content unless `content` is given. */
async function upload(opts: UploadOpts = {}): Promise<JsonResponse> {
  seq += 1;
  const content = opts.content ?? `evidence #${seq}`;
  const file: Part = {
    name: 'file',
    filename: opts.filename ?? `file-${seq}.pdf`,
    contentType: opts.contentType ?? 'application/pdf',
    data: typeof content === 'string' ? new TextEncoder().encode(content) : content,
  };
  const fields: Part[] = Object.entries(opts.fields ?? {}).map(([name, value]) => ({ name, value }));
  const { payload, contentType } = multipart(opts.fieldsFirst ? [...fields, file] : [file, ...fields]);
  const t = opts.token === undefined ? token : opts.token;
  const res = await app.inject({
    method: 'POST',
    url: '/api/attachments/upload',
    headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), 'content-type': contentType, ...opts.headers },
    payload,
  });
  return { status: res.statusCode, body: res.json() as JsonResponse['body'] };
}

async function download(
  id: string,
  t: string | null = token,
): Promise<{
  status: number;
  headers: Record<string, string | string[] | number | undefined>;
  body: Buffer;
  json: () => unknown;
}> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/attachments/${id}/download`,
    headers: t ? { authorization: `Bearer ${t}` } : {},
  });
  return { status: res.statusCode, headers: res.headers, body: res.rawPayload, json: () => res.json() };
}

async function login(email: string, password: string): Promise<string> {
  const res = await call('POST', '/auth/login', { body: { email, password }, token: null });
  return res.body.token as string;
}

async function addUser(email: string, password: string, roles: string[]): Promise<string> {
  const id = newId();
  await db.owner.drizzle.insert(users).values({
    id,
    tenantId: db.tenantId,
    email,
    name: email,
    passwordHash: hashPassword(password),
    roles,
    defaultCompanyId: db.companyId,
  });
  await db.owner.drizzle
    .insert(companyMemberships)
    .values({ tenantId: db.tenantId, userId: id, companyId: db.companyId, roles });
  return login(email, password);
}

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  configureStorage(new LocalStorage(await mkdtemp(join(tmpdir(), 'daifuku-attachments-api-'))));
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: JWT_SECRET });
  // Until server.ts wires the routes itself; once it does, registering twice would be a duplicate-route error.
  if (!app.hasRoute({ method: 'POST', url: '/api/attachments/upload' })) registerAttachmentRoutes(app, { db: db.app });
  await app.ready();
  token = await login('admin@example.com', 'password');
  salesToken = await addUser('sales@example.com', 'sales-pw', ['sales']);
  viewerToken = await addUser('viewer@example.com', 'viewer-pw', ['viewer']);
  nobodyToken = await addUser('nobody@example.com', 'nobody-pw', []);
  partnerId = (await call('POST', '/api/partner', { body: { name: '証憑取引先', code: 'AT-1' } })).body.id as string;
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('attachment entity through the API (AC-1)', () => {
  it('AC-1 the module is registered with its entity, actions and role table; no role has delete', async () => {
    expect(AttachmentsModule.name).toBe('attachment');
    const meta = await call('GET', '/meta', { token: salesToken });
    const entity = (meta.body.entities as { name: string; ops: string[]; module: string }[]).find(
      (e) => e.name === 'attachment',
    );
    expect(entity).toMatchObject({ module: 'attachment', ops: ['read', 'create', 'update'] });
    const viewerMeta = await call('GET', '/meta', { token: viewerToken });
    expect(
      (viewerMeta.body.entities as { name: string; ops: string[] }[]).find((e) => e.name === 'attachment')?.ops,
    ).toEqual(['read']);
    const actions = (meta.body.actions as { name: string }[]).map((a) => a.name);
    expect(actions).toEqual(
      expect.arrayContaining([
        'attachment.search',
        'attachment.supersede',
        'attachment.link',
        'attachment.for_record',
        'attachment.list',
        'attachment.get',
        'attachment.create',
        'attachment.update',
      ]),
    );
    const fields = await call('GET', '/meta/entities/attachment');
    expect((fields.body.fields as { name: string }[]).map((f) => f.name)).toEqual([
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
  });

  it('AC-1 DELETE is refused for every role: 403 without the op, 409 (INVALID_STATE) for admin via the hook', async () => {
    const a = await upload();
    expect(a.status).toBe(200);
    const id = a.body.id as string;
    const sales = await call('DELETE', `/api/attachment/${id}`, { token: salesToken });
    expect(sales.status).toBe(403);
    expect(sales.body.error?.code).toBe('PERMISSION_DENIED');
    const admin = await call('DELETE', `/api/attachment/${id}`);
    expect(admin.status).toBe(409);
    expect(admin.body.error).toMatchObject({ code: 'INVALID_STATE', hint: expect.stringContaining('supersede') });
    expect((await call('GET', `/api/attachment/${id}`)).status).toBe(200);
  });
});

describe('POST /api/attachments/upload (AC-2, AC-7)', () => {
  it('AC-2 stores the bytes, creates the row with the multipart fields and returns it (fields before or after the file)', async () => {
    const res = await upload({
      content: '%PDF-1.7 領収書',
      filename: '領収書 2026-04.pdf',
      contentType: 'application/pdf',
      fields: {
        kind: 'receipt',
        txnDate: '2026-04-01',
        amount: '12345.50',
        partnerId,
        note: 'タクシー代',
        linkedEntity: 'partner',
        linkedId: partnerId,
      },
      token: salesToken,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      filename: '領収書 2026-04.pdf',
      contentType: 'application/pdf',
      size: Buffer.byteLength('%PDF-1.7 領収書'),
      kind: 'receipt',
      txnDate: '2026-04-01',
      amount: '12345.5',
      partnerId,
      note: 'タクシー代',
      linkedEntity: 'partner',
      linkedId: partnerId,
      supersededById: null,
      companyId: db.companyId,
      version: 1,
    });
    expect(res.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.storageKey).toMatch(new RegExp(`^${db.tenantId}/`));
    const got = await call('GET', `/api/attachment/${res.body.id as string}`, { token: viewerToken });
    expect(got.body).toMatchObject({ sha256: res.body.sha256, storageKey: res.body.storageKey });
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'attachment', res.body.id as string));
    expect(trail.map((e) => e.op)).toEqual(['create']);
    // the same request with the text fields first (browser form order) behaves identically
    const first = await upload({
      fields: { kind: 'contract', txnDate: '2026-05-01', amount: '100' },
      fieldsFirst: true,
      contentType: 'text/csv; charset=utf-8',
      filename: 'ledger.csv',
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      kind: 'contract',
      txnDate: '2026-05-01',
      amount: '100',
      contentType: 'text/csv',
      filename: 'ledger.csv',
    });
  });

  it('AC-2 rejects disallowed types, empty/missing files, non-multipart bodies and bad fields with the standard error shape; stores nothing', async () => {
    const before = (await call('GET', '/api/attachment?limit=1')).body.total as number;
    const zip = await upload({ contentType: 'application/zip', filename: 'x.zip' });
    expect(zip.status).toBe(400);
    expect(zip.body.error).toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'file.contentType' }] },
      hint: expect.stringContaining('application/pdf'),
    });
    const empty = await upload({ content: new Uint8Array(0) });
    expect(empty.status).toBe(400);
    expect(empty.body.error?.details).toMatchObject({ issues: [{ path: 'file' }] });
    const onlyFields = multipart([{ name: 'kind', value: 'receipt' }]);
    const noFile = await app.inject({
      method: 'POST',
      url: '/api/attachments/upload',
      headers: { authorization: `Bearer ${token}`, 'content-type': onlyFields.contentType },
      payload: onlyFields.payload,
    });
    expect(noFile.statusCode).toBe(400);
    expect(noFile.json()).toMatchObject({
      error: {
        code: 'VALIDATION',
        details: { issues: [{ path: 'file' }] },
        hint: expect.stringContaining('multipart'),
      },
    });
    const json = await call('POST', '/api/attachments/upload', { body: { kind: 'receipt' } });
    expect(json.status).toBe(400);
    expect(json.body.error?.hint).toContain('multipart');
    const badKind = await upload({ fields: { kind: 'selfie' } });
    expect(badKind.status).toBe(400);
    expect(badKind.body.error?.details).toMatchObject({ issues: [{ path: 'kind' }] });
    const badDate = await upload({ fields: { txnDate: '2026/04/01' } });
    expect(badDate.body.error?.details).toMatchObject({ issues: [{ path: 'txnDate' }] });
    const badAmount = await upload({ fields: { amount: '1,000' } });
    expect(badAmount.body.error?.details).toMatchObject({ issues: [{ path: 'amount' }] });
    const ghostPartner = await upload({ fields: { partnerId: newId() } });
    expect(ghostPartner.status).toBe(404);
    expect(ghostPartner.body.error?.code).toBe('NOT_FOUND');
    const halfLink = await upload({ fields: { linkedEntity: 'partner' } });
    expect(halfLink.body.error?.details).toMatchObject({ issues: [{ path: 'linkedId' }] });
    const unknownField = await upload({ fields: { storageKey: 'evil/key' } });
    expect(unknownField.status).toBe(400);
    expect(unknownField.body.error?.details).toMatchObject({ issues: [{ path: 'storageKey' }] });
    expect((await call('GET', '/api/attachment?limit=1')).body.total).toBe(before);
  });

  it('AC-2 a file over 20 MB is refused (413) by the multipart limit; exactly 20 MB is accepted', async () => {
    const tooBig = await upload({
      content: new Uint8Array(20 * 1024 * 1024 + 1).fill(0x41),
      contentType: 'text/plain',
      filename: 'big.txt',
    });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error).toMatchObject({
      code: 'VALIDATION',
      message: expect.stringContaining('20 MB'),
      details: { maxBytes: 20 * 1024 * 1024 },
    });
    const limit = await upload({
      content: new Uint8Array(20 * 1024 * 1024).fill(0x42),
      contentType: 'text/plain',
      filename: 'exact.txt',
    });
    expect(limit.status, JSON.stringify(limit.body)).toBe(200);
    expect(limit.body.size).toBe(20 * 1024 * 1024);
  });

  it('AC-2 upload requires the create op: viewer -> 403, no token -> 401; agent header is recorded as the actor', async () => {
    const viewer = await upload({ token: viewerToken });
    expect(viewer.status).toBe(403);
    expect(viewer.body.error?.code).toBe('PERMISSION_DENIED');
    const anon = await upload({ token: null });
    expect(anon.status).toBe(401);
    const byAgent = await upload({ headers: { 'x-agent-id': 'claude-1' } });
    expect(byAgent.status).toBe(200);
    expect(byAgent.body.createdBy).toBe(db.adminUserId);
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'attachment', byAgent.body.id as string));
    expect(trail[0]).toMatchObject({
      op: 'create',
      actorType: 'agent',
      actorId: 'claude-1',
      onBehalfOf: db.adminUserId,
    });
  });

  it('AC-7 the same content twice in one company -> 409 CONFLICT with details.existingId; another company may store it', async () => {
    const first = await upload({ content: 'duplicate evidence', filename: 'a.pdf' });
    expect(first.status).toBe(200);
    const again = await upload({
      content: 'duplicate evidence',
      filename: 'renamed.pdf',
      fields: { kind: 'receipt' },
      token: salesToken,
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({
      code: 'CONFLICT',
      details: { existingId: first.body.id, sha256: first.body.sha256 },
      hint: expect.stringContaining('supersede'),
    });
    const otherCompany = newId();
    await db.owner
      .sql`insert into companies (id, tenant_id, code, name) values (${otherCompany}, ${db.tenantId}, 'T2', 'Second Co')`;
    const elsewhere = await upload({ content: 'duplicate evidence', headers: { 'x-company-id': otherCompany } });
    expect(elsewhere.status).toBe(200);
    expect(elsewhere.body).toMatchObject({ companyId: otherCompany, sha256: first.body.sha256 });
    expect(elsewhere.body.id).not.toBe(first.body.id);
  });
});

describe('GET /api/attachments/:id/download (AC-3)', () => {
  it('AC-3 streams the bytes with the original filename (RFC 5987) and content type; viewer may read', async () => {
    const content = 'PNG bytes   日本語';
    const up = await upload({ content, filename: 'スキャン (1).png', contentType: 'image/png' });
    expect(up.status).toBe(200);
    const res = await download(up.body.id as string, viewerToken);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="____ (1).png"; filename*=UTF-8''%E3%82%B9%E3%82%AD%E3%83%A3%E3%83%B3%20%281%29.png`,
    );
    expect(Number(res.headers['content-length'])).toBe(Buffer.byteLength(content));
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.toString('utf8')).toBe(content);
    expect(contentDisposition('plain.pdf')).toBe(`attachment; filename="plain.pdf"; filename*=UTF-8''plain.pdf`);
    expect(contentDisposition('quo"te\\.pdf')).toBe(
      `attachment; filename="quo_te_.pdf"; filename*=UTF-8''quo%22te%5C.pdf`,
    );
  });

  it('AC-3 applies the attachment.get permission check: no read role -> 403, unknown/foreign ids -> 404, no token -> 401, bad id -> 400', async () => {
    const up = await upload();
    const id = up.body.id as string;
    const nobody = await download(id, nobodyToken);
    expect(nobody.status).toBe(403);
    expect(nobody.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    const missing = await download(newId());
    expect(missing.status).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect((await download(id, null)).status).toBe(401);
    const bad = await download('not-a-uuid');
    expect(bad.status).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'VALIDATION', details: { issues: [{ path: 'id' }] } } });
    // another tenant's admin cannot see it (RLS + company scope): 404, not 403, so ids do not leak
    await bootstrapTenant(db.owner, {
      tenantName: 'Other',
      companyCode: 'O1',
      companyName: 'Other Co',
      adminEmail: 'other@example.com',
      adminName: 'Other',
      adminPassword: 'other-pw',
    });
    const otherToken = await login('other@example.com', 'other-pw');
    expect((await download(id, otherToken)).status).toBe(404);
    expect((await call('GET', `/api/attachment/${id}`, { token: otherToken })).status).toBe(404);
  });
});

describe('actions through the API (AC-4, AC-5, AC-6, AC-8)', () => {
  it('AC-4 attachment.search combines date range, amount range, partner and kind; REST list/search still work', async () => {
    const tag = `search-${newId()}`;
    const a = await upload({
      content: `${tag} a`,
      fields: { txnDate: '2026-06-10', amount: '5000', partnerId, kind: 'invoice_received', note: tag },
    });
    const b = await upload({
      content: `${tag} b`,
      fields: { txnDate: '2026-06-20', amount: '7000', partnerId, kind: 'invoice_received', note: tag },
    });
    const c = await upload({
      content: `${tag} c`,
      fields: { txnDate: '2026-07-01', amount: '7000', kind: 'receipt', note: tag },
    });
    for (const r of [a, b, c]) expect(r.status).toBe(200);
    const ids = (res: JsonResponse) => (res.body.items as { id: string }[]).map((i) => i.id);
    const june = await call('POST', '/actions/attachment.search', {
      body: { txnDateFrom: '2026-06-01', txnDateTo: '2026-06-30', partnerId },
      token: viewerToken,
    });
    expect(june.status).toBe(200);
    expect(ids(june)).toEqual([b.body.id, a.body.id]); // txnDate desc
    const amount = await call('POST', '/actions/attachment.search', { body: { amountFrom: '6000', amountTo: '7000' } });
    expect(ids(amount).sort()).toEqual([b.body.id, c.body.id].sort());
    const combo = await call('POST', '/actions/attachment.search', {
      body: { txnDateFrom: '2026-06-01', amountFrom: '6000', kind: 'invoice_received', partnerId },
    });
    expect(ids(combo)).toEqual([b.body.id]);
    expect((combo.body.items as { amount: string }[])[0]?.amount).toBe('7000');
    const invalid = await call('POST', '/actions/attachment.search', {
      body: { txnDateFrom: '2026-07-01', txnDateTo: '2026-06-01' },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error?.details).toMatchObject({ issues: [{ path: 'txnDateFrom' }] });
    const rest = await call('GET', `/api/attachment?search=${encodeURIComponent(tag)}&orderBy=txnDate:asc`);
    expect(ids(rest)).toEqual([a.body.id, b.body.id, c.body.id]);
    expect((await call('POST', '/actions/attachment.search', { body: {}, token: nobodyToken })).status).toBe(403);
  });

  it('AC-5/AC-8 supersede records the replacement and reason in the audit trail; the old file is still downloadable', async () => {
    const v1 = await upload({
      content: 'invoice v1 (wrong amount)',
      fields: { kind: 'invoice_received', amount: '1000' },
    });
    const v2 = await upload({
      content: 'invoice v2 (corrected)',
      fields: { kind: 'invoice_received', amount: '1100' },
    });
    const res = await call('POST', '/actions/attachment.supersede', {
      body: { id: v1.body.id, newAttachmentId: v2.body.id, reason: '金額誤り。訂正版を受領' },
      token: salesToken,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: v1.body.id, supersededById: v2.body.id, version: 2 });
    const audit = await call('GET', `/api/attachment/${v1.body.id as string}/audit`);
    const entries = audit.body as unknown as { op: string; action: string | null; after: Record<string, unknown> }[];
    expect(entries.map((e) => e.op).sort()).toEqual(['create', 'supersede', 'update']);
    expect(entries.find((e) => e.op === 'supersede')).toMatchObject({
      action: 'attachment.supersede',
      after: { supersededById: v2.body.id, reason: '金額誤り。訂正版を受領' },
    });
    const old = await download(v1.body.id as string, viewerToken);
    expect(old.status).toBe(200);
    expect(old.body.toString('utf8')).toBe('invoice v1 (wrong amount)');
    expect((await call('GET', `/api/attachment/${v1.body.id as string}`)).body.supersededById).toBe(v2.body.id);
    const twice = await call('POST', '/actions/attachment.supersede', {
      body: { id: v1.body.id, newAttachmentId: v2.body.id, reason: 'again' },
    });
    expect(twice.status).toBe(409);
    expect(twice.body.error?.code).toBe('INVALID_STATE');
    const noReason = await call('POST', '/actions/attachment.supersede', {
      body: { id: v2.body.id, newAttachmentId: v1.body.id },
    });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error?.details).toMatchObject({ issues: [{ path: 'reason' }] });
    const viewer = await call('POST', '/actions/attachment.supersede', {
      body: { id: v2.body.id, newAttachmentId: v1.body.id, reason: 'x' },
      token: viewerToken,
    });
    expect(viewer.status).toBe(403);
  });

  it('AC-6 link verifies the entity and record visibility; for_record lists a record’s attachments newest first', async () => {
    const a = await upload();
    const b = await upload();
    const linked = await call('POST', '/actions/attachment.link', {
      body: { id: a.body.id, entity: 'partner', recordId: partnerId },
      token: salesToken,
    });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ linkedEntity: 'partner', linkedId: partnerId });
    expect(
      (
        await call('POST', '/actions/attachment.link', {
          body: { id: b.body.id, entity: 'partner', recordId: partnerId },
        })
      ).status,
    ).toBe(200);
    const list = await call('POST', '/actions/attachment.for_record', {
      body: { entity: 'partner', recordId: partnerId },
      token: viewerToken,
    });
    expect(list.status).toBe(200);
    const listed = (list.body.items as { id: string }[]).map((i) => i.id);
    expect(listed.slice(0, 2)).toEqual([b.body.id, a.body.id]);
    expect(listed).toContain(a.body.id);
    const unknownEntity = await call('POST', '/actions/attachment.link', {
      body: { id: a.body.id, entity: 'nope', recordId: partnerId },
    });
    expect(unknownEntity.status).toBe(400);
    expect(unknownEntity.body.error?.details).toMatchObject({ issues: [{ path: 'entity' }] });
    const ghost = await call('POST', '/actions/attachment.link', {
      body: { id: a.body.id, entity: 'partner', recordId: newId() },
    });
    expect(ghost.status).toBe(404);
    const viewer = await call('POST', '/actions/attachment.link', {
      body: { id: a.body.id, entity: 'partner', recordId: partnerId },
      token: viewerToken,
    });
    expect(viewer.status).toBe(403);
    // the REST PATCH path is guarded by the same hook
    const patch = await call('PATCH', `/api/attachment/${a.body.id as string}`, {
      body: { linkedEntity: 'partner', linkedId: newId() },
    });
    expect(patch.status).toBe(404);
  });

  it('OpenAPI documents the upload and download routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    const doc = res.json() as { paths: Record<string, Record<string, { tags?: string[]; summary?: string }>> };
    expect(doc.paths['/api/attachments/upload']?.post).toMatchObject({
      tags: ['attachment'],
      summary: expect.stringContaining('multipart'),
    });
    expect(doc.paths['/api/attachments/{id}/download']?.get).toMatchObject({ tags: ['attachment'] });
    for (const name of ['attachment.search', 'attachment.supersede', 'attachment.link', 'attachment.for_record'])
      expect(doc.paths[`/actions/${name}`]?.post).toBeDefined();
  });
});
