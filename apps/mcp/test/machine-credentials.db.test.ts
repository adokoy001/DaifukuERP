// docs/specs/machine-credentials.md AC-24..AC-26: apps/mcp authenticated by an `mcp` API key instead of a password.
// The fixture entity `mcp_test_item` stands in for partner (see mcp.db.test.ts).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  auditLog,
  issueMachineCredential,
  machineCredentials,
  newId,
  registerCrudActions,
  revokeMachineCredential,
  stepUpIdentity,
  users,
  withContext,
  type Context,
  type ContextParams,
  type Logger,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/server.ts';
import { openMachineSession } from '../src/session.ts';
import './fixtures/entities.ts';

registerCrudActions();
const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
let db: TestDb;

async function asAdmin<T>(fn: (ctx: Context) => Promise<T>): Promise<T> {
  const [row] = await db.owner.drizzle
    .select({ v: users.sessionVersion })
    .from(users)
    .where(eq(users.id, db.adminUserId));
  const params: ContextParams = {
    tenantId: db.tenantId,
    companyId: db.companyId,
    actor: { type: 'user', id: db.adminUserId },
    roles: ['admin'],
    tenantAdmin: true,
    accessScope: 'all',
    sessionVersion: row?.v ?? 1,
  };
  return withContext(db.app, params, fn);
}
async function issueKey(purpose: 'mcp' | 'integration', roles = ['clerk']) {
  const step = await asAdmin(async (ctx) =>
    stepUpIdentity(ctx, ctx.sessionVersion ?? 1, 'password', undefined, 'unused-without-mfa'),
  );
  return asAdmin((ctx) =>
    issueMachineCredential(ctx, {
      name: `MCP ${purpose}`,
      purpose,
      companyId: db.companyId,
      roles,
      expiresInDays: 30,
      stepUpToken: step.stepUpToken,
    }),
  );
}
async function connect(params: ContextParams) {
  const server = buildMcpServer({ app: db.app, owner: db.owner, params, log: silent });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'mcp-key-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return { client, server };
}
async function tool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args }, CallToolResultSchema);
  const content = 'content' in result && Array.isArray(result.content) ? result.content : [];
  const text = (content[0] as { text?: string } | undefined)?.text ?? '{}';
  return { isError: result.isError === true, body: JSON.parse(text) as Record<string, unknown> };
}
const deniedReasons = async (id: string) =>
  (
    await db.owner.drizzle
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'machine_credential'), eq(auditLog.recordId, id), eq(auditLog.op, 'use_denied')))
  ).map((row) => (row.after as { reason: string }).reason);

beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db?.close();
});

describe('MCP with an API key (AC-24..AC-26)', () => {
  it('AC-24 builds a machine context for an mcp key, runs tools as the key and records the use', async () => {
    const { token, credential } = await issueKey('mcp');
    const session = await openMachineSession(db.owner, db.app, token, undefined, silent);
    expect(session?.credential).toEqual({
      id: credential.id,
      name: 'MCP mcp',
      companyId: db.companyId,
      roles: ['clerk'],
    });
    expect(session?.params).toMatchObject({
      tenantId: db.tenantId,
      companyId: db.companyId,
      actor: { type: 'machine', id: credential.id },
      roles: ['clerk'],
      tenantAdmin: false,
      accessScope: 'all',
    });
    if (!session) throw new Error('expected a machine session');
    const { client, server } = await connect(session.params);
    try {
      const created = await tool(client, 'mcp_test_item_create', {
        name: '鍵で作成',
        code: `K-${newId().slice(0, 8)}`,
      });
      expect(created.isError, JSON.stringify(created.body)).toBe(false);
      const listed = await tool(client, 'mcp_test_item_list');
      expect(listed.isError).toBe(false);
      const [audit] = await db.owner.drizzle
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'mcp_test_item'), eq(auditLog.recordId, String(created.body.id))));
      expect(audit).toMatchObject({ actorType: 'machine', actorId: credential.id, onBehalfOf: null });
      const [row] = await db.owner.drizzle
        .select()
        .from(machineCredentials)
        .where(eq(machineCredentials.id, credential.id));
      expect(row?.lastUsedAt).not.toBeNull();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('AC-25 refuses integration keys, revoked or unknown keys and another company, auditing known keys', async () => {
    const integration = await issueKey('integration');
    expect(await openMachineSession(db.owner, db.app, integration.token, undefined, silent)).toBeNull();
    expect(await deniedReasons(integration.credential.id)).toEqual(['purpose_mismatch']);
    const revoked = await issueKey('mcp');
    await asAdmin((ctx) => revokeMachineCredential(ctx, revoked.credential.id, {}));
    expect(await openMachineSession(db.owner, db.app, revoked.token, undefined, silent)).toBeNull();
    expect(await deniedReasons(revoked.credential.id)).toEqual(['revoked']);
    const other = await issueKey('mcp');
    expect(await openMachineSession(db.owner, db.app, other.token, newId(), silent)).toBeNull();
    expect(await deniedReasons(other.credential.id)).toEqual(['company_mismatch']);
    expect(await openMachineSession(db.owner, db.app, other.token, db.companyId, silent)).not.toBeNull();
    expect(await openMachineSession(db.owner, db.app, `dfk_${'n'.repeat(43)}`, undefined, silent)).toBeNull();
    expect(await openMachineSession(db.owner, db.app, 'not-a-key', undefined, silent)).toBeNull();
  });

  it('AC-26 re-validates every call: revocation and expiry turn tools into isError PERMISSION_DENIED', async () => {
    const { token, credential } = await issueKey('mcp');
    const session = await openMachineSession(db.owner, db.app, token, undefined, silent);
    if (!session) throw new Error('expected a machine session');
    const { client, server } = await connect(session.params);
    try {
      expect((await tool(client, 'mcp_test_item_list')).isError).toBe(false);
      await asAdmin((ctx) => revokeMachineCredential(ctx, credential.id, { reason: '接続中の失効' }));
      const refused = await tool(client, 'mcp_test_item_list');
      expect(refused).toMatchObject({ isError: true, body: { code: 'PERMISSION_DENIED' } });
      await expect(client.listTools()).rejects.toThrow();
      expect(await deniedReasons(credential.id)).toEqual(['revoked']);
    } finally {
      await client.close();
      await server.close();
    }
    const expiring = await issueKey('mcp');
    const live = await openMachineSession(db.owner, db.app, expiring.token, undefined, silent);
    if (!live) throw new Error('expected a machine session');
    const second = await connect(live.params);
    try {
      await db.owner.drizzle
        .update(machineCredentials)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(machineCredentials.id, expiring.credential.id));
      expect(await tool(second.client, 'mcp_test_item_list')).toMatchObject({
        isError: true,
        body: { code: 'PERMISSION_DENIED' },
      });
      expect(await deniedReasons(expiring.credential.id)).toEqual(['expired']);
    } finally {
      await second.client.close();
      await second.server.close();
    }
  });
});
