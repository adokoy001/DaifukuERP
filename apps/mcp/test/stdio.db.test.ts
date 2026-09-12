// AC-1 end to end: the real entrypoint (src/main.ts) as a child process over stdio, driven by the SDK's stdio client.
// Verifies env-based login, the agent actor in the audit log, and that stdout carries only protocol traffic.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { auditTrail, registerCrudActions } from '@daifuku/kernel';
import { APP_URL, OWNER_URL, freshDb, type TestDb } from '@daifuku/kernel/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import './fixtures/entities.ts';

registerCrudActions();

const APP_DIR = resolve(import.meta.dirname, '..');
const TSX = resolve(APP_DIR, 'node_modules/.bin/tsx');
const ENTRY = resolve(import.meta.dirname, 'fixtures/stdio-entry.ts');

let db: TestDb;

function spawnServer(env: Record<string, string>): { client: Client; transport: StdioClientTransport; stderr: string[] } {
  const stderr: string[] = [];
  const transport = new StdioClientTransport({
    command: TSX,
    // The entry registers the test module first so the child serves the entities the DB was created from.
    args: [ENTRY],
    cwd: APP_DIR,
    env: { PATH: process.env.PATH ?? '', DATABASE_URL_OWNER: OWNER_URL, DATABASE_URL: APP_URL, ...env },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
  return { client: new Client({ name: 'stdio-test-client', version: '0.0.0' }), transport, stderr };
}

beforeAll(async () => {
  expect(existsSync(TSX)).toBe(true);
  db = await freshDb();
});
afterAll(async () => {
  await db.close();
});

describe('AC-1 stdio entrypoint', () => {
  it('AC-1 authenticates from env, lists tools and writes audit rows as agent DAIFUKU_AGENT_ID on behalf of the user', async () => {
    const { client, transport, stderr } = spawnServer({ DAIFUKU_EMAIL: 'admin@example.com', DAIFUKU_PASSWORD: 'password', DAIFUKU_AGENT_ID: 'stdio-agent' });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['mcp_test_item_list', 'mcp_test_item_create']));

      const res = await client.callTool({ name: 'mcp_test_item_create', arguments: { name: 'Over stdio', code: 'S-1' } }, CallToolResultSchema);
      const first: unknown = 'content' in res && Array.isArray(res.content) ? res.content[0] : undefined;
      const text = typeof first === 'object' && first !== null && 'text' in first && typeof first.text === 'string' ? first.text : '{}';
      const created = JSON.parse(text) as { id: string; name: string };
      expect(res.isError).not.toBe(true);
      expect(created.name).toBe('Over stdio');

      const trail = await db.run({}, (ctx) => auditTrail(ctx, 'mcp_test_item', created.id));
      expect(trail[0]).toMatchObject({ op: 'create', actorType: 'agent', actorId: 'stdio-agent', onBehalfOf: db.adminUserId });
      expect(stderr.join('')).toContain('daifuku mcp server ready');
    } finally {
      await client.close();
    }
  }, 60000);

  it('AC-1 refuses to start with wrong credentials (exit code 3, reason on stderr)', async () => {
    const { child, stderr, exited } = spawnRaw({ DAIFUKU_EMAIL: 'admin@example.com', DAIFUKU_PASSWORD: 'wrong' });
    expect(await exited).toBe(3);
    expect(child.exitCode).toBe(3);
    expect(stderr.join('')).toContain('authentication failed');
  }, 60000);

  it('AC-1 exits cleanly when the client closes stdin (no zombie server processes)', async () => {
    const { child, stderr, exited } = spawnRaw({ DAIFUKU_EMAIL: 'admin@example.com', DAIFUKU_PASSWORD: 'password' });
    await new Promise<void>((ready) => {
      child.stderr?.on('data', () => {
        if (stderr.join('').includes('daifuku mcp server ready')) ready();
      });
    });
    child.stdin?.end();
    expect(await exited).toBe(0);
  }, 60000);
});

function spawnRaw(env: Record<string, string>): { child: ReturnType<typeof spawn>; stderr: string[]; exited: Promise<number | null> } {
  const child = spawn(TSX, [ENTRY], {
    cwd: APP_DIR,
    env: { PATH: process.env.PATH ?? '', DATABASE_URL_OWNER: OWNER_URL, DATABASE_URL: APP_URL, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stderr: string[] = [];
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
  const exited = new Promise<number | null>((done) => child.on('exit', (code) => done(code)));
  return { child, stderr, exited };
}
