import { configureStorage, LocalStorage, newId } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { uploadAttachment } from '@daifuku/mod-attachments';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';

let db: TestDb;
let app: FastifyInstance;
let directory: string;
let token: string;
beforeAll(async () => {
  db = await freshDb();
  directory = await mkdtemp(join(tmpdir(), 'daifuku-evidence-integrity-'));
  configureStorage(new LocalStorage(directory));
  app = await buildServer({ app: db.app, owner: db.owner, jwtSecret: 'test-integrity-secret' });
  const result = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'admin@example.com', password: 'password' },
  });
  token = (result.json() as { token: string }).token;
});
afterAll(async () => {
  await app.close();
  await db.close();
});

async function evidence(text: string) {
  return db.run({}, (ctx) =>
    uploadAttachment(ctx, {
      data: new TextEncoder().encode(text),
      filename: 'evidence.txt',
      contentType: 'text/plain',
      fields: {},
    }),
  );
}

async function download(id: string) {
  return app.inject({
    method: 'GET',
    url: `/api/attachments/${id}/download`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('foundation-refresh attachment boundaries', () => {
  it('AC-4 refuses forged storage metadata through generic creation', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/api/attachment',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        storageKey: `${newId()}/${newId()}`,
        filename: 'forged.txt',
        size: 1,
        sha256: 'a'.repeat(64),
        contentType: 'text/plain',
        kind: 'other',
      },
    });
    expect(result.statusCode).toBeGreaterThanOrEqual(400);
    const rows = await db.owner.sql`select id from attachment where filename = 'forged.txt'`;
    expect(rows).toHaveLength(0);
  });

  it('AC-4 refuses a legacy corrupt cross-tenant storage key before reading bytes', async () => {
    const row = await evidence('scope-check');
    // Simulates an imported legacy record that predated the write-ownership guard.
    await db.owner.sql`update attachment set storage_key = ${`${newId()}/${newId()}`} where id = ${row.id}`;
    const result = await download(row.id);
    expect(result.statusCode).toBe(403);
  });

  it('AC-4 detects content tampering and still serves unchanged evidence', async () => {
    const row = await evidence('original evidence');
    expect((await download(row.id)).body).toBe('original evidence');
    await writeFile(join(directory, row.storageKey), 'altered evidence!');
    const result = await download(row.id);
    expect(result.statusCode).toBe(409);
    expect(result.json()).toMatchObject({ error: { code: 'INVALID_STATE' } });
  });
});
