// docs/specs/print-templates.md AC-2, AC-19, AC-20 over HTTP with the full runtime: GET /meta lists each role's print
// declarations (`actions[].print` next to the input schema), and POST /actions/<render action> answers 403 (no read),
// 404 (unknown id) and 409 (INVALID_STATE) with the usual error body.
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';

let db: TestDb;
let app: FastifyInstance;
const tokens: Record<string, string> = {};

type Method = 'GET' | 'POST' | 'PUT';
async function call(method: Method, url: string, token: string, payload?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (payload !== undefined) headers['content-type'] = 'application/json';
  return app.inject({ method, url, headers, ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}) });
}
async function login(email: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ token: string }>().token;
}
async function userWith(name: string, roles: string[]): Promise<string> {
  const password = `${name}-print-password`;
  const created = await call('POST', '/admin/users', tokens.admin as string, {
    email: `${name}-print@example.com`,
    name,
    password,
  });
  expect(created.statusCode, created.body).toBe(200);
  const assign = await call(
    'PUT',
    `/admin/users/${created.json<{ id: string }>().id}/companies/${db.companyId}`,
    tokens.admin as string,
    { expectedVersion: 0, roles, accessScope: 'all', storeIds: [] },
  );
  expect(assign.statusCode, assign.body).toBe(200);
  return login(`${name}-print@example.com`, password);
}

type ActionOut = {
  name: string;
  inputSchema?: { properties?: Record<string, unknown> };
  print?: { entity: string; idInput: string; label: { ja: string; en: string }; when?: unknown; fields?: unknown };
};
async function printActions(token: string): Promise<Map<string, ActionOut>> {
  const r = await call('GET', '/meta', token);
  expect(r.statusCode, r.body).toBe(200);
  return new Map(
    r
      .json<{ actions: ActionOut[] }>()
      .actions.filter((a) => a.print)
      .map((a) => [a.name, a]),
  );
}

beforeAll(async () => {
  db = await freshDb();
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'print-meta-test', logger: false });
  await app.ready();
  tokens.admin = await login('admin@example.com', 'password');
  tokens.sales = await userWith('sales', ['sales']);
  tokens.purchasing = await userWith('purchasing', ['purchasing']);
  tokens.employee = await userWith('employee', ['workforce_employee']);
}, 120_000);
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('print declarations in /meta per role (AC-2, AC-20)', () => {
  it('AC-2 sales sees the invoice, statement, quotation, order, delivery note and payment documents with their bindings', async () => {
    const actions = await printActions(tokens.sales as string);
    expect([...actions.keys()].sort()).toEqual([
      'payment.render_payment_notice_html',
      'payment.render_receipt_html',
      'sales.render_invoice_html',
      'sales.render_statement_html',
      'trade.render_delivery_note_html',
      'trade.render_order_html',
      'trade.render_quotation_html',
    ]);
    expect(actions.get('sales.render_invoice_html')?.print).toEqual({
      entity: 'sales_invoice',
      label: { ja: '請求書を表示', en: 'View invoice' },
      idInput: 'id',
    });
    const statement = actions.get('sales.render_statement_html');
    expect(statement?.print).toMatchObject({ entity: 'partner', idInput: 'partnerId', when: { isCustomer: true } });
    expect(Object.keys(statement?.inputSchema?.properties ?? {})).toEqual(['partnerId', 'closingDate']);
    expect(actions.get('trade.render_order_html')?.print?.when).toEqual({ direction: 'purchase' });
  });

  it('AC-20 purchasing has no read on quotations or sales invoices, so those documents are not offered', async () => {
    const names = [...(await printActions(tokens.purchasing as string)).keys()].sort();
    expect(names).toEqual([
      'payment.render_payment_notice_html',
      'payment.render_receipt_html',
      'trade.render_delivery_note_html',
      'trade.render_order_html',
    ]);
  });

  it('AC-20 an employee sees only the payslip', async () => {
    expect([...(await printActions(tokens.employee as string)).keys()]).toEqual(['workforce.render_payslip_html']);
  });
});

describe('POST /actions/<render action> errors (AC-19, AC-20)', () => {
  it('AC-20 403 for a role without read', async () => {
    const r = await call('POST', '/actions/trade.render_quotation_html', tokens.purchasing as string, {
      id: '00000000-0000-4000-8000-000000000000',
    });
    expect(r.statusCode, r.body).toBe(403);
    expect(r.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
  });

  it('AC-19 404 for an id the caller cannot see', async () => {
    const r = await call('POST', '/actions/trade.render_quotation_html', tokens.admin as string, {
      id: '00000000-0000-4000-8000-000000000000',
    });
    expect(r.statusCode, r.body).toBe(404);
    expect(r.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('AC-15 409 for a statement of a partner that is not a customer; 400 for a closing date that is not one', async () => {
    const supplier = await call('POST', '/api/partner', tokens.admin as string, { name: '仕入専業', isSupplier: true });
    expect(supplier.statusCode, supplier.body).toBe(200);
    const r = await call('POST', '/actions/sales.render_statement_html', tokens.admin as string, {
      partnerId: supplier.json<{ id: string }>().id,
    });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toMatchObject({ error: { code: 'INVALID_STATE' } });
    const customer = await call('POST', '/api/partner', tokens.admin as string, {
      name: '得意先',
      isCustomer: true,
      closingDay: 20,
    });
    const bad = await call('POST', '/actions/sales.render_statement_html', tokens.sales as string, {
      partnerId: customer.json<{ id: string }>().id,
      closingDate: '2026-10-19',
    });
    expect(bad.statusCode, bad.body).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'VALIDATION' } });
    const ok = await call('POST', '/actions/sales.render_statement_html', tokens.sales as string, {
      partnerId: customer.json<{ id: string }>().id,
      closingDate: '2026-10-20',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json<{ html: string }>().html).toContain('<!DOCTYPE html>');
  });
});
