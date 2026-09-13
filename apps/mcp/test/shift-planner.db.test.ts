import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  companyMemberships,
  hashPassword,
  newId,
  registry,
  repo,
  runAction,
  users,
  type Logger,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import '../src/modules.ts';
import { buildMcpServer } from '../src/server.ts';
import { openAgentSession } from '../src/session.ts';
let db: TestDb;
const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db?.close();
});
it('employee-shift-planner MCP keeps preferences personal and rechecks live company scope', async () => {
  const id = newId(),
    email = 'shift-mcp@example.com';
  const site = await db.run({}, (ctx) =>
    repo(ctx, registry.entity('workforce_site')).create({ code: 'MCP-SHIFT', name: 'Synthetic shift site' }),
  );
  await db.owner.drizzle.insert(users).values({
    id,
    tenantId: db.tenantId,
    email,
    name: 'Shift MCP',
    passwordHash: hashPassword('shift-mcp-password'),
    roles: [],
    defaultCompanyId: db.companyId,
  });
  await db.owner.drizzle.insert(companyMemberships).values({
    tenantId: db.tenantId,
    userId: id,
    companyId: db.companyId,
    roles: ['workforce_employee'],
    accessScope: 'sites',
    siteIds: [site.id],
  });
  await db.run({}, (ctx) =>
    runAction(ctx, 'workforce.register_employee', {
      userId: id,
      siteId: site.id,
      code: 'MCP',
      name: 'Shift MCP',
      hiredOn: '2026-01-01',
    }),
  );
  const session = await openAgentSession(
    db.owner,
    { email, password: 'shift-mcp-password', agentId: 'shift-self-service', companyId: undefined },
    log,
  );
  if (!session) throw new Error('Synthetic login failed');
  const server = buildMcpServer({ app: db.app, owner: db.owner, params: session.params, log });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'shift-boundary-test', version: '1' });
  await client.connect(clientTransport);
  try {
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain('workforce_my_shifts');
    expect(tools).toContain('workforce_save_shift_availability');
    expect(tools).not.toContain('workforce_shift_board');
    const weekStart = '2026-09-14',
      days = Array.from({ length: 7 }, (_, i) => ({
        date: `2026-09-${14 + i}`,
        preference: 'available',
        startMinute: 540,
        endMinute: 1020,
      }));
    const saved = await client.callTool(
      { name: 'workforce_save_shift_availability', arguments: { weekStart, expectedVersion: 0, days } },
      CallToolResultSchema,
    );
    expect(saved.isError, JSON.stringify(saved)).not.toBe(true);
    const own = await client.callTool({ name: 'workforce_my_shifts', arguments: { weekStart } }, CallToolResultSchema);
    expect(own.isError).not.toBe(true);
    expect(JSON.stringify(own)).toContain('Shift MCP');
    const forged = await client.callTool(
      {
        name: 'workforce_save_shift_availability',
        arguments: { weekStart, expectedVersion: 1, days, userId: newId() },
      },
      CallToolResultSchema,
    );
    expect(forged.isError).toBe(true);
    await db.owner.sql`update user_company_memberships set site_ids = '[]'::jsonb where user_id = ${id}`;
    const revoked = await client.callTool(
      { name: 'workforce_my_shifts', arguments: { weekStart } },
      CallToolResultSchema,
    );
    expect(JSON.stringify(revoked)).not.toContain('Shift MCP');
  } finally {
    await client.close();
    await server.close();
  }
});
