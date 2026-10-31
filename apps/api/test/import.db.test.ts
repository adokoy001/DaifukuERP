// csv-import (docs/specs/csv-import.md) AC-1/AC-2/AC-9/AC-10 over HTTP: POST /api/:entity/import and
// /actions/<entity>.import share the derived action; GET /api/:entity/import-template.csv; body and permission limits.
import { companyMemberships, hashPassword, newId, users } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';

let db: TestDb;
let app: FastifyInstance;
let admin: string;
let viewer: string;

async function call(method: 'GET' | 'POST', url: string, body?: unknown, token = admin) {
  const res = await app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { payload: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  return res;
}

async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  return (res.json() as { token: string }).token;
}

beforeAll(async () => {
  db = await freshDb();
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'test-secret' });
  await app.ready();
  admin = await login('admin@example.com', 'password');
  const viewerId = newId();
  await db.owner.drizzle.insert(users).values({
    id: viewerId,
    tenantId: db.tenantId,
    email: 'viewer@example.com',
    name: 'Viewer',
    passwordHash: await hashPassword('viewer-pw'),
    roles: ['viewer'],
    defaultCompanyId: db.companyId,
  });
  await db.owner.drizzle
    .insert(companyMemberships)
    .values({ tenantId: db.tenantId, userId: viewerId, companyId: db.companyId, roles: ['viewer'] });
  viewer = await login('viewer@example.com', 'viewer-pw');
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const partners = async (code: string) =>
  (await call('GET', `/api/partner?where=${encodeURIComponent(JSON.stringify({ code }))}`)).json() as {
    total: number;
    items: Record<string, unknown>[];
  };

describe('csv-import over REST', () => {
  it('AC-1/AC-2/AC-6: POST /api/partner/import with ja labels: dry-run changes nothing, execute creates', async () => {
    const rows = [
      { 取引先コード: 'IMP-001', 名称: '取込商事', 顧客: 'はい', 締め日: '20', 課税区分: '免税事業者' },
      { 取引先コード: 'IMP-002', 名称: '取込物産', 登録番号: 'T123' },
    ];
    const dry = await call('POST', '/api/partner/import', { rows, mode: 'dry-run', onExisting: 'skip' });
    expect(dry.statusCode).toBe(200);
    expect(dry.json()).toMatchObject({
      mode: 'dry-run',
      committed: false,
      keyField: 'code',
      summary: { created: 1, errors: 1 },
      rows: [
        { line: 1, status: 'created' },
        { line: 2, status: 'error', messages: [{ field: 'invoiceRegistrationNo', column: '登録番号' }] },
      ],
    });
    expect((await partners('IMP-001')).total).toBe(0);
    const exec = await call('POST', '/api/partner/import', { rows, mode: 'execute', onExisting: 'skip' });
    expect(exec.json()).toMatchObject({ committed: true, summary: { created: 1, errors: 1 } });
    expect((await partners('IMP-001')).items[0]).toMatchObject({
      name: '取込商事',
      isCustomer: true,
      closingDay: 20,
      taxStatus: 'exempt',
    });
    // The same action under /actions: the second run skips the existing code.
    const again = await call('POST', '/actions/partner.import', { rows, mode: 'execute', onExisting: 'skip' });
    expect(again.json()).toMatchObject({ summary: { created: 0, skipped: 1, errors: 1 } });
  });

  it('AC-1: documents, opted-out masters (and unknown entities) have no import route', async () => {
    const doc = await call('POST', '/api/sales_invoice/import', {
      rows: [{ x: '1' }],
      mode: 'dry-run',
      onExisting: 'skip',
    });
    expect(doc.statusCode).toBe(409);
    expect(doc.json()).toMatchObject({ error: { code: 'INVALID_STATE' } });
    // `import: false`: their generic create is always refused, so an import could only fail row by row.
    for (const entity of ['stock_ledger', 'stock_balance', 'attachment']) {
      const res = await call('POST', `/api/${entity}/import`, {
        rows: [{ x: '1' }],
        mode: 'dry-run',
        onExisting: 'skip',
      });
      expect(res.statusCode, entity).toBe(409);
      expect((await call('POST', `/actions/${entity}.import`, { rows: [], mode: 'dry-run' })).statusCode, entity).toBe(
        404,
      );
    }
    expect((await call('POST', '/api/nope/import', { rows: [], mode: 'dry-run', onExisting: 'skip' })).statusCode).toBe(
      404,
    );
  });

  it('AC-9: a role without create is refused (import and template)', async () => {
    const body = { rows: [{ name: 'viewer' }], mode: 'dry-run', onExisting: 'skip' };
    const denied = await call('POST', '/api/partner/import', body, viewer);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    expect((await call('GET', '/api/partner/import-template.csv', undefined, viewer)).statusCode).toBe(403);
  });

  it('AC-2: a body over 2 MB is refused with a VALIDATION body; 5,001 rows with a VALIDATION issue on rows', async () => {
    const huge = JSON.stringify({ rows: [{ name: 'x'.repeat(2 * 1024 * 1024) }], mode: 'dry-run', onExisting: 'skip' });
    const tooLarge = await call('POST', '/api/partner/import', huge);
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json()).toMatchObject({ error: { code: 'VALIDATION', message: 'Request body is too large.' } });
    const many = Array.from({ length: 5001 }, (_, i) => ({ name: `p${i}` }));
    const tooMany = await call('POST', '/api/partner/import', { rows: many, mode: 'dry-run', onExisting: 'skip' });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json()).toMatchObject({ error: { code: 'VALIDATION', details: { issues: [{ path: 'rows' }] } } });
  });

  it('AC-10: GET /api/:entity/import-template.csv is a BOM UTF-8 header in ja (default) or en', async () => {
    const ja = await call('GET', '/api/partner/import-template.csv');
    expect(ja.statusCode).toBe(200);
    expect(ja.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(ja.headers['content-disposition']).toBe('attachment; filename="partner-import-template.csv"');
    expect(ja.body.startsWith('\uFEFF取引先コード,名称,カナ名称,顧客,仕入先,登録番号,課税区分,')).toBe(true);
    expect(ja.body.endsWith('\r\n')).toBe(true);
    const en = await call('GET', '/api/product/import-template.csv?lang=en');
    expect(en.body).toBe(
      '\uFEFFCode,Name,Name (kana),Kind,Tax category,Unit of measure,Sale price,Purchase price,Sold,Purchased,Active,Description\r\n',
    );
    expect((await call('GET', '/api/partner/import-template.csv?lang=fr')).statusCode).toBe(400);
  });
});
