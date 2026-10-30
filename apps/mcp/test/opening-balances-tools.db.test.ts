// docs/specs/opening-balances.md AC-8 over MCP: the four imports and the reversal are mutating tools, the status is
// read-only, and an MCP call gets the same 2 MB input limit as the HTTP body limit.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { newId, registerCrudActions, type Logger } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { InventoryModule } from '@daifuku/mod-inventory';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/server.ts';
import { openAgentSession } from '../src/session.ts';

registerCrudActions();
const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

let db: TestDb;
let server: Server;
let client: Client;

beforeAll(async () => {
  expect(InventoryModule.name).toBe('inventory');
  db = await freshDb();
  const session = await openAgentSession(
    db.owner,
    { email: 'admin@example.com', password: 'password', agentId: 'opening-agent', companyId: undefined },
    silent,
  );
  if (!session) throw new Error('no MCP session');
  server = buildMcpServer({ app: db.app, owner: db.owner, params: session.params, log: silent });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'opening-test-client', version: '0.0.0' });
  await client.connect(clientTransport);
});
afterAll(async () => {
  await client?.close();
  await server?.close();
  await db?.close();
});

async function call(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args }, CallToolResultSchema);
  const content = 'content' in res && Array.isArray(res.content) ? res.content : [];
  const text = (content[0] as { text?: string } | undefined)?.text ?? '{}';
  return { isError: res.isError === true, body: JSON.parse(text) as Record<string, unknown> };
}

describe('opening balances over MCP', () => {
  it('AC-8: five mutating tools and a read-only status tool are listed', async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of [
      'accounting_import_opening_balances',
      'accounting_reverse_opening_balances',
      'sales_import_opening_receivables',
      'purchase_import_opening_payables',
      'inventory_import_opening_stock',
    ])
      expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(false);
    expect(byName.get('accounting_opening_balance_status')?.annotations?.readOnlyHint).toBe(true);
  });

  it('AC-8 AC-29: the status answers through MCP; an input over 2 MB is a VALIDATION result', async () => {
    const status = await call('accounting_opening_balance_status', {});
    expect(status.isError).toBe(true);
    expect(JSON.stringify(status.body)).toContain('no_fiscal_year');
    const rows = Array.from({ length: 1000 }, () => ({
      accountCode: 'a'.repeat(1000),
      partnerCode: 'p'.repeat(1000),
      memo: 'm'.repeat(1000),
    }));
    const big = await call('accounting_import_opening_balances', { fiscalYearId: newId(), mode: 'dry-run', rows });
    expect(big.isError).toBe(true);
    expect(JSON.stringify(big.body)).toContain('VALIDATION');
    expect(JSON.stringify(big.body)).toContain('bytes');
  });
});
