// AC-1..AC-5 of docs/specs/mcp-app.md against the real test DB, through the SDK's in-memory transport.
// modules/partner is built concurrently, so the entity under test is the fixture `mcp_test_item` (spec names partner_*).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  auditTrail,
  companyMemberships,
  hashPassword,
  newId,
  registerCrudActions,
  registry,
  todayLocal,
  users,
  type ContextParams,
  type Logger,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/server.ts';
import { openAgentSession } from '../src/session.ts';
import './fixtures/entities.ts';

registerCrudActions();

const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const LOGIN = { email: 'admin@example.com', password: 'password', agentId: 'test-agent', companyId: undefined };

let db: TestDb;
let params: ContextParams;
let server: Server;
let client: Client;

async function connectClient(p: ContextParams): Promise<{ client: Client; server: Server }> {
  const s = buildMcpServer({ app: db.app, owner: db.owner, params: p, log: silent });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await s.connect(serverTransport);
  const c = new Client({ name: 'mcp-test-client', version: '0.0.0' });
  await c.connect(clientTransport);
  return { client: c, server: s };
}

/** Calls a tool and returns the parsed JSON text (results and error bodies are both JSON text). */
async function call(
  c: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ isError: boolean; body: Record<string, unknown> }> {
  const res = await c.callTool({ name, arguments: args }, CallToolResultSchema);
  const content: unknown[] = 'content' in res && Array.isArray(res.content) ? res.content : [];
  expect(content).toHaveLength(1);
  return { isError: res.isError === true, body: JSON.parse(textOf(content[0])) as Record<string, unknown> };
}

function textOf(content: unknown): string {
  const text = typeof content === 'object' && content !== null && 'text' in content ? content.text : undefined;
  expect(typeof text).toBe('string');
  return typeof text === 'string' ? text : '{}';
}

beforeAll(async () => {
  db = await freshDb();
  const session = await openAgentSession(db.owner, LOGIN, silent);
  expect(session).not.toBeNull();
  params = session?.params ?? { tenantId: '', companyId: null, actor: { type: 'agent', id: '' }, roles: [] };
  ({ client, server } = await connectClient(params));
});

afterAll(async () => {
  await client.close();
  await server.close();
  await db.close();
});

describe('AC-1 startup authentication -> agent context', () => {
  it('AC-1 actor is the agent acting on behalf of the authenticated user, with that user roles/tenant/default company', () => {
    expect(params.actor).toEqual({ type: 'agent', id: 'test-agent', onBehalfOf: db.adminUserId });
    expect(params.tenantId).toBe(db.tenantId);
    expect(params.companyId).toBe(db.companyId);
    expect(params.roles).toEqual(['admin']);
  });

  it('AC-1 DAIFUKU_COMPANY_ID overrides the default company; bad credentials are rejected', async () => {
    const other = newId();
    await db.owner
      .sql`insert into companies (id, tenant_id, code, name) values (${other}, ${db.tenantId}, 'OTHER', 'Other')`;
    await expect(openAgentSession(db.owner, { ...LOGIN, companyId: newId() }, silent)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    const s = await openAgentSession(db.owner, { ...LOGIN, companyId: other }, silent);
    expect(s?.params.companyId).toBe(other);
    expect(await openAgentSession(db.owner, { ...LOGIN, password: 'wrong' }, silent)).toBeNull();
    expect(await openAgentSession(db.owner, { ...LOGIN, email: 'nobody@example.com' }, silent)).toBeNull();
  });
});

describe('AC-2 tools/list mirrors the action registry', () => {
  it('AC-2 lists one tool per action with derived names, bilingual description, mutates flag and readOnlyHint', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toHaveLength(registry.allActions().length);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'mcp_test_item_list',
        'mcp_test_item_create',
        'mcp_test_item_update',
        'mcp_test_order_submit',
        'mcp_test_echo',
      ]),
    );

    const list = tools.find((t) => t.name === 'mcp_test_item_list');
    const create = tools.find((t) => t.name === 'mcp_test_item_create');
    expect(list?.description).toBe(
      'List MCP test item records with optional where/search/orderBy/limit/offset.\nMCPテスト品目を検索・一覧します。where/search/orderBy/limit/offset を指定できます。\nmutates: no',
    );
    expect(list?.annotations).toEqual({ title: 'mcp_test_item.list', readOnlyHint: true });
    expect(create?.description?.endsWith('\nmutates: yes')).toBe(true);
    expect(create?.annotations).toEqual({ title: 'mcp_test_item.create', readOnlyHint: false });
  });

  it('AC-2 inputSchema is JSON Schema derived from the zod input (decimals as strings, required fields, no $schema)', async () => {
    const { tools } = await client.listTools();
    const create = tools.find((t) => t.name === 'mcp_test_item_create');
    expect(create?.inputSchema.type).toBe('object');
    expect(create?.inputSchema.$schema).toBeUndefined();
    expect(create?.inputSchema.required).toEqual(['name']);
    const props = create?.inputSchema.properties ?? {};
    expect(props.name).toMatchObject({ type: 'string', maxLength: 100 });
    expect(props.kind).toMatchObject({ enum: ['goods', 'service'] });
    expect(props.price).toEqual({ type: ['string', 'null'] });
    const list = tools.find((t) => t.name === 'mcp_test_item_list');
    expect(Object.keys(list?.inputSchema.properties ?? {})).toEqual(['where', 'search', 'orderBy', 'limit', 'offset']);
  });
});

describe('AC-3 tools/call runs the action in a context; errors are self-describing', () => {
  let createdId: string;

  it('AC-3/AC-5 create then list round-trips through the tools', async () => {
    const created = await call(client, 'mcp_test_item_create', { name: 'Widget', code: 'W-1', price: '12.5' });
    expect(created.isError).toBe(false);
    expect(created.body).toMatchObject({
      name: 'Widget',
      code: 'W-1',
      price: '12.5',
      kind: 'goods',
      isActive: true,
      version: 1,
      companyId: db.companyId,
    });
    createdId = created.body.id as string;

    const listed = await call(client, 'mcp_test_item_list', { where: { code: 'W-1' } });
    expect(listed.isError).toBe(false);
    expect(listed.body.total).toBe(1);
    expect((listed.body.items as Record<string, unknown>[]).map((i) => i.id)).toEqual([createdId]);

    const got = await call(client, 'mcp_test_item_get', { id: createdId });
    expect(got.body.name).toBe('Widget');
  });

  it('AC-5 audit rows written through the MCP server carry actorType agent and onBehalfOf the user', async () => {
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'mcp_test_item', createdId));
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      op: 'create',
      actorType: 'agent',
      actorId: 'test-agent',
      onBehalfOf: db.adminUserId,
    });
    expect(trail[0]?.requestId).toBeTruthy();
  });

  it('AC-3 the context reaches the handler (echo reports actor type and onBehalfOf)', async () => {
    const r = await call(client, 'mcp_test_echo', { text: 'ping' });
    expect(r.body).toEqual({ text: 'ping', actorType: 'agent', onBehalfOf: db.adminUserId });
  });

  it('AC-3 validation failure -> isError with VALIDATION code, field issues and a hint', async () => {
    const r = await call(client, 'mcp_test_item_create', { name: 'x'.repeat(101), kind: 'nope' });
    expect(r.isError).toBe(true);
    expect(r.body).toMatchObject({ code: 'VALIDATION' });
    expect(typeof r.body.hint).toBe('string');
    const issues = (r.body.details as { issues: { path: string }[] }).issues.map((i) => i.path);
    expect(issues).toEqual(expect.arrayContaining(['name', 'kind']));
  });

  it('AC-3 not found and unknown tool -> NOT_FOUND with a hint; nothing is thrown at protocol level', async () => {
    const missing = await call(client, 'mcp_test_item_get', { id: newId() });
    expect(missing.isError).toBe(true);
    expect(missing.body).toMatchObject({ code: 'NOT_FOUND' });
    const unknown = await call(client, 'no_such_tool', {});
    expect(unknown.isError).toBe(true);
    expect(unknown.body).toMatchObject({ code: 'NOT_FOUND', details: { tool: 'no_such_tool' } });
    expect(String(unknown.body.hint)).toContain('tools/list');
  });

  it('AC-3 permission denied for a role without the op (default deny, ADR-0007)', async () => {
    const viewerId = newId();
    await db.owner.drizzle.insert(users).values({
      id: viewerId,
      tenantId: db.tenantId,
      email: 'viewer@example.com',
      name: 'Viewer',
      passwordHash: await hashPassword('viewer-password'),
      roles: ['viewer'],
      defaultCompanyId: db.companyId,
    });
    await db.owner.drizzle
      .insert(companyMemberships)
      .values({ tenantId: db.tenantId, userId: viewerId, companyId: db.companyId, roles: ['viewer'] });
    const viewer = await connectClient({
      ...params,
      actor: { type: 'agent', id: 'viewer-agent', onBehalfOf: viewerId },
      roles: ['viewer'],
    });
    try {
      const denied = await call(viewer.client, 'mcp_test_item_create', { name: 'nope' });
      expect(denied.isError).toBe(true);
      expect(denied.body).toMatchObject({
        code: 'PERMISSION_DENIED',
        details: { entity: 'mcp_test_item', op: 'create', roles: ['viewer'] },
      });
      // Read is allowed. (Not `mcp_test_item_list`: with a row present the kernel's generic list action fails its own
      // output schema for roles that have `secretNote` masked — kernel bug, recorded in docs/log/2026-09-10-mcp-app.md.)
      const allowed = await call(viewer.client, 'mcp_test_count_items', {});
      expect(allowed.isError).toBe(false);
      expect(allowed.body).toEqual({ count: 1 });
    } finally {
      await viewer.client.close();
      await viewer.server.close();
    }
  });

  it('AC-3 a non-Daifuku error becomes a generic INTERNAL result with a requestId and without internals', async () => {
    const r = await call(client, 'mcp_test_broken', {});
    expect(r.isError).toBe(true);
    expect(r.body).toMatchObject({ code: 'INTERNAL' });
    expect(String(r.body.message)).not.toContain('secret-internal-detail');
    expect(typeof (r.body.details as { requestId: unknown }).requestId).toBe('string');
  });

  it('AC-3 document lifecycle works through generic tools (create -> submit assigns a number)', async () => {
    const order = await call(client, 'mcp_test_order_create', {
      itemId: createdId,
      date: todayLocal(new Date()),
      amount: '100',
    });
    expect(order.isError).toBe(false);
    expect(order.body.docstatus).toBe(0);
    const submitted = await call(client, 'mcp_test_order_submit', { id: order.body.id });
    expect(submitted.isError).toBe(false);
    expect(submitted.body.docstatus).toBe(1);
    expect(String(submitted.body.number)).toMatch(/^MO-\d{4}-\d{4}$/);
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'mcp_test_order', order.body.id as string));
    expect(trail.map((t) => t.op)).toEqual(['submit', 'create']);
    expect(trail.every((t) => t.actorType === 'agent')).toBe(true);
  });
});

describe('AC-4 resources expose metadata', () => {
  it('AC-4 resources/list has daifuku://meta and one entry per entity; a template covers daifuku://entities/{name}', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(
      expect.arrayContaining([
        'daifuku://meta',
        'daifuku://entities/mcp_test_item',
        'daifuku://entities/mcp_test_order',
      ]),
    );
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toEqual(['daifuku://entities/{name}']);
  });

  it('AC-4 daifuku://meta returns appMeta(ctx) as JSON', async () => {
    const res = await client.readResource({ uri: 'daifuku://meta' });
    const first = res.contents[0];
    expect(first?.mimeType).toBe('application/json');
    const meta = JSON.parse(textOf(first)) as {
      entities: { name: string }[];
      actions: { name: string }[];
      modules: { name: string }[];
      roles: string[];
    };
    expect(meta.entities.map((e) => e.name)).toEqual(expect.arrayContaining(['mcp_test_item', 'mcp_test_order']));
    expect(meta.actions.map((a) => a.name)).toEqual(expect.arrayContaining(['mcp_test_item.list', 'mcp_test.echo']));
    expect(meta.modules.map((m) => m.name)).toContain('mcp_test');
    expect(meta.roles).toEqual(['admin']);
  });

  it('AC-4 daifuku://entities/{name} returns entityMeta; unknown entity is a protocol error with a hint', async () => {
    const res = await client.readResource({ uri: 'daifuku://entities/mcp_test_item' });
    const meta = JSON.parse(textOf(res.contents[0])) as {
      name: string;
      fields: { name: string; kind: string }[];
      ops: string[];
    };
    expect(meta.name).toBe('mcp_test_item');
    expect(meta.fields.find((f) => f.name === 'price')).toMatchObject({ kind: 'decimal' });
    expect(meta.ops).toContain('create');
    await expect(client.readResource({ uri: 'daifuku://entities/nope' })).rejects.toThrow(
      /entity "nope" does not exist/,
    );
    await expect(client.readResource({ uri: 'daifuku://other' })).rejects.toThrow(/does not exist/);
  });
});
