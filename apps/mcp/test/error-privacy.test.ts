import { Conflict, type Logger } from '@daifuku/kernel';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { withProtocolErrors } from '../src/errors.ts';

const SECRET = 'private-database-password';

describe('quality-foundation AC-1: MCP protocol errors', () => {
  it('sanitizes non-tool protocol errors and diagnostic logs', async () => {
    const logs: unknown[] = [];
    const log: Logger = { info: () => undefined, warn: () => undefined, error: (message, data) => void logs.push({ message, data }) };
    const error = await withProtocolErrors(log, 'resources/read', () => Promise.reject(new Error(`SQL params: ${SECRET}`, { cause: { code: '23503', detail: SECRET } }))).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(McpError);
    expect(error).toMatchObject({ data: { code: 'INTERNAL', details: { requestId: expect.any(String) } } });
    expect(String(error)).not.toContain(SECRET);
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    expect(logs).toEqual([expect.objectContaining({ data: expect.objectContaining({ method: 'resources/read', category: 'database', sqlState: '23503' }) })]);
  });

  it('keeps intentional business errors useful to callers', async () => {
    const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
    await expect(withProtocolErrors(log, 'tools/list', () => Promise.reject(new Conflict('Version changed', 'Reload.', { version: 2 })))).rejects.toMatchObject({ data: { code: 'CONFLICT', hint: 'Reload.', details: { version: 2 } } });
  });
});
