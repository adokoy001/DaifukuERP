import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  bootstrapTenant,
  changeOwnPassword,
  companyMemberships,
  defineEntity,
  f,
  hashPassword,
  label,
  newId,
  registerCrudActions,
  repo,
  revokeOwnSessions,
  users,
  type Logger,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/server.ts';
import { openAgentSession } from '../src/session.ts';
import './fixtures/entities.ts';

const Site = defineEntity({
  name: 'mcp_scope_site',
  label: label('拠点', 'Site'),
  fields: { name: f.text({ required: true }) },
  siteAccess: { kind: 'store', field: 'id' },
  permissions: { roles: { workforce_employee: ['read'] } },
});
const SiteProbe = defineEntity({
  name: 'mcp_site_probe',
  label: label('拠点試験', 'Site probe'),
  fields: {
    siteId: f.ref('mcp_scope_site', { required: true }),
    userId: f.uuid({ required: true }),
    name: f.text({ required: true }),
    storageKey: f.text({ hidden: true, outputHidden: true }),
  },
  siteAccess: { kind: 'store', field: 'siteId' },
  permissions: {
    roles: { workforce_employee: ['read'] },
    rowRules: [{ roles: ['workforce_employee'], where: { userId: '$ctx.userId' } }],
  },
});
registerCrudActions();
const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
let db: TestDb;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db.close();
});

describe('foundation-refresh MCP identity and current authorization', () => {
  it('propagates siteIds and onBehalfOf, then revokes scope on an already-connected MCP client', async () => {
    const userId = newId();
    const siteId = (await db.run({}, (ctx) => repo(ctx, Site).create({ name: 'Assigned' }))).id;
    const outside = (await db.run({}, (ctx) => repo(ctx, Site).create({ name: 'Outside' }))).id;
    await db.owner.drizzle.insert(users).values({
      id: userId,
      tenantId: db.tenantId,
      name: 'Site scoped employee',
      email: 'site-scope@example.com',
      passwordHash: await hashPassword('password'),
      roles: ['workforce_employee'],
      defaultCompanyId: db.companyId,
    });
    await db.owner.drizzle.insert(companyMemberships).values({
      tenantId: db.tenantId,
      userId,
      companyId: db.companyId,
      roles: ['workforce_employee'],
      accessScope: 'sites',
      siteIds: [siteId],
    });
    const allowed = await db.run({}, (ctx) =>
      repo(ctx, SiteProbe).create({
        siteId,
        userId,
        name: 'Own assigned site',
        storageKey: 'internal-storage-location',
      }),
    );
    await db.run({}, (ctx) => repo(ctx, SiteProbe).create({ siteId: outside, userId, name: 'Own outside site' }));
    await db.run({}, (ctx) =>
      repo(ctx, SiteProbe).create({ siteId, userId: newId(), name: 'Other employee same site' }),
    );
    const session = await openAgentSession(
      db.owner,
      { email: 'site-scope@example.com', password: 'password', agentId: 'workforce-agent', companyId: undefined },
      log,
    );
    if (!session) throw new Error('test login failed');
    expect(session.params).toMatchObject({
      accessScope: 'sites',
      siteIds: [siteId],
      actor: { type: 'agent', onBehalfOf: userId },
    });
    const server = buildMcpServer({ app: db.app, owner: db.owner, params: session.params, log });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'scope-test', version: '1' });
    await client.connect(clientTransport);
    try {
      const first = await client.callTool({ name: 'mcp_site_probe_list', arguments: {} }, CallToolResultSchema);
      expect(first.isError).not.toBe(true);
      expect(JSON.stringify(first)).toContain(allowed.id);
      expect(JSON.stringify(first)).not.toContain('storageKey');
      expect(JSON.stringify(first)).not.toContain('internal-storage-location');
      const own = await client.callTool(
        { name: 'mcp_site_probe_get', arguments: { id: allowed.id } },
        CallToolResultSchema,
      );
      expect(own.isError).not.toBe(true);
      expect(JSON.stringify(own)).toContain(allowed.id);
      expect(JSON.stringify(own)).not.toContain('storageKey');
      expect(JSON.stringify(own)).not.toContain('internal-storage-location');
      expect(JSON.stringify(first)).not.toContain('Own outside site');
      expect(JSON.stringify(first)).not.toContain('Other employee same site');
      await db.owner.sql`update user_company_memberships set site_ids = '[]'::jsonb where user_id = ${userId}`;
      const revoked = await client.callTool(
        { name: 'mcp_site_probe_get', arguments: { id: allowed.id } },
        CallToolResultSchema,
      );
      expect(revoked.isError).toBe(true);
      expect(JSON.stringify(revoked)).toContain('NOT_FOUND');
      const empty = await client.callTool({ name: 'mcp_site_probe_list', arguments: {} }, CallToolResultSchema);
      expect(empty.isError).not.toBe(true);
      expect(JSON.stringify(empty)).not.toContain(allowed.id);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('AC-1 revokes writes and resources on an already-connected client', async () => {
    const id = newId();
    await db.owner.drizzle.insert(users).values({
      id,
      tenantId: db.tenantId,
      name: 'Revocation test',
      email: 'revoke@example.com',
      passwordHash: await hashPassword('password'),
      roles: ['admin'],
      defaultCompanyId: db.companyId,
    });
    await db.owner.drizzle
      .insert(companyMemberships)
      .values({ tenantId: db.tenantId, userId: id, companyId: db.companyId, roles: ['admin'] });
    const session = await openAgentSession(
      db.owner,
      { email: 'revoke@example.com', password: 'password', agentId: 'revocation-agent', companyId: undefined },
      log,
    );
    if (!session) throw new Error('test login failed');
    const server = buildMcpServer({ app: db.app, owner: db.owner, params: session.params, log });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'revocation-test', version: '1' });
    await client.connect(clientTransport);
    try {
      const first = await client.callTool(
        { name: 'mcp_test_item_create', arguments: { name: 'Before revocation' } },
        CallToolResultSchema,
      );
      expect(first.isError).not.toBe(true);
      await db.owner.sql`update user_company_memberships set roles = '["viewer"]'::jsonb where user_id = ${id}`;
      const denied = await client.callTool(
        { name: 'mcp_test_item_create', arguments: { name: 'After role revocation' } },
        CallToolResultSchema,
      );
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).toContain('PERMISSION_DENIED');
      const readable = await client.readResource({ uri: 'daifuku://meta' });
      expect(JSON.stringify(readable)).toContain('viewer');
      await db.owner.sql`update users set active = false where id = ${id}`;
      const disabled = await client.callTool(
        { name: 'mcp_test_item_create', arguments: { name: 'After disabled' } },
        CallToolResultSchema,
      );
      expect(disabled.isError).toBe(true);
      await expect(client.readResource({ uri: 'daifuku://meta' })).rejects.toThrow();
      await expect(client.listTools()).rejects.toThrow();
      const rows = await db.owner.sql`select name from mcp_test_item order by name`;
      expect(rows.map((row) => row.name)).toEqual(['Before revocation']);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('AC-1 rejects a company belonging to another tenant before creating a session', async () => {
    const other = await bootstrapTenant(db.owner, {
      tenantName: 'Foreign tenant',
      companyCode: 'FOREIGN',
      companyName: 'Foreign',
      adminEmail: 'foreign@example.com',
      adminName: 'Foreign',
      adminPassword: 'password',
    });
    await expect(
      openAgentSession(
        db.owner,
        { email: 'admin@example.com', password: 'password', agentId: 'test', companyId: other.companyId },
        log,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it.each(['password', 'logout-all'] as const)(
    'quality-foundation AC-2/3: %s revokes existing tools and metadata sessions',
    async (operation) => {
      const id = newId();
      const email = `${id}@example.com`;
      await db.owner.drizzle.insert(users).values({
        id,
        tenantId: db.tenantId,
        name: 'Account security',
        email,
        passwordHash: await hashPassword('current-password'),
        roles: [],
        defaultCompanyId: db.companyId,
      });
      await db.owner.drizzle
        .insert(companyMemberships)
        .values({ tenantId: db.tenantId, userId: id, companyId: db.companyId, roles: ['viewer'] });
      const session = await openAgentSession(
        db.owner,
        { email, password: 'current-password', agentId: 'self-service-test', companyId: undefined },
        log,
      );
      if (!session || session.params.sessionVersion === undefined) throw new Error('test login failed');
      const sessionVersion = session.params.sessionVersion;
      const server = buildMcpServer({ app: db.app, owner: db.owner, params: session.params, log });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: 'self-service-test', version: '1' });
      await client.connect(clientTransport);
      try {
        await expect(client.listTools()).resolves.toHaveProperty('tools');
        await db.run({ actor: { type: 'user', id }, roles: ['viewer'], companyId: null }, (ctx) =>
          operation === 'password'
            ? changeOwnPassword(ctx, sessionVersion, {
                currentPassword: 'current-password',
                newPassword: 'new-private-password',
              })
            : revokeOwnSessions(ctx, sessionVersion, {}),
        );
        const result = await client.callTool(
          { name: 'mcp_test_echo', arguments: { text: 'after logout' } },
          CallToolResultSchema,
        );
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain('PERMISSION_DENIED');
        await expect(client.listTools()).rejects.toThrow();
        await expect(client.listResources()).rejects.toThrow();
        await expect(client.listResourceTemplates()).rejects.toThrow();
        await expect(client.readResource({ uri: 'daifuku://meta' })).rejects.toThrow();
      } finally {
        await client.close();
        await server.close();
      }
    },
  );
});
