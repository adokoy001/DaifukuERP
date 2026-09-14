import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@daifuku/kernel';
import { createReadiness } from '../src/deployment/readiness.ts';
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'daifuku-readiness-'));
  temporary.push(root);
  const migrationsDirectory = join(root, 'migrations');
  const storageDirectory = join(root, 'evidence');
  await mkdir(join(migrationsDirectory, 'meta'), { recursive: true });
  await mkdir(storageDirectory, { mode: 0o700 });
  const sql = 'select 1;';
  await writeFile(join(migrationsDirectory, '0000_test.sql'), sql);
  await writeFile(
    join(migrationsDirectory, 'meta/_journal.json'),
    JSON.stringify({ entries: [{ idx: 0, when: 100, tag: '0000_test' }] }),
  );
  const identity = { database: 'dedicated', address: '127.0.0.1', port: '5432', oid: '123' };
  const row = { ...identity, hash: createHash('sha256').update(sql).digest('hex'), created_at: '100' };
  const owner = database(() => Promise.resolve([row]));
  const app = database(() => Promise.resolve([identity]));
  return { root, migrationsDirectory, storageDirectory, row, identity, owner, app, cacheMs: 0 };
}
function database(work: () => Promise<unknown>) {
  const cancel = vi.fn();
  const sql = vi.fn(() => Object.assign(work(), { cancel }));
  // Unit transport double: only tagged SQL and cancellation are used by this adapter.
  return { sql, cancel, db: { sql } as unknown as Database };
}
function options(f: Awaited<ReturnType<typeof fixture>>) {
  return { ...f, owner: f.owner.db, app: f.app.db };
}
describe('opaque, bounded deployment readiness', () => {
  it('matches the entire release migration history and checks both principals without creating evidence', async () => {
    const f = await fixture();
    const probe = createReadiness(options(f));
    expect(await probe()).toEqual({ ready: true });
    expect(f.owner.sql).toHaveBeenCalledOnce();
    expect(f.app.sql).toHaveBeenCalledOnce();
    expect(await readdir(f.storageDirectory)).toEqual([]);
  });
  it('fails closed on missing, changed, extra or differently dated migration records', async () => {
    const f = await fixture();
    for (const rows of [[], [{ ...f.row, hash: 'changed' }], [f.row, f.row], [{ ...f.row, created_at: '101' }]]) {
      const owner = database(() => Promise.resolve(rows));
      expect(await createReadiness({ ...options(f), owner: owner.db })()).toEqual({ ready: false });
    }
  });
  it('does not expose connection errors and requires a private, real evidence directory', async () => {
    const f = await fixture();
    const failed = database(() => Promise.reject(new Error('postgres://synthetic:secret@host/db')));
    expect(await createReadiness({ ...options(f), app: failed.db })()).toEqual({ ready: false });
    await chmod(f.storageDirectory, 0o755);
    expect(await createReadiness(options(f))()).toEqual({ ready: false });
    await chmod(f.storageDirectory, 0o700);
    const link = join(f.root, 'linked');
    await symlink(f.storageDirectory, link);
    expect(await createReadiness({ ...options(f), storageDirectory: link })()).toEqual({ ready: false });
    expect(await createReadiness({ ...options(f), storageDirectory: join(f.root, 'missing') })()).toEqual({
      ready: false,
    });
    expect(await readdir(f.root)).not.toContain('missing');
  });
  it('deduplicates concurrent probes, cancels timed out queries, and recovers on a new check', async () => {
    const f = await fixture();
    const stalled = database(() => new Promise(() => undefined));
    const probe = createReadiness({ ...options(f), owner: stalled.db, timeoutMs: 10 });
    expect(await Promise.all([probe(), probe(), probe()])).toEqual([
      { ready: false },
      { ready: false },
      { ready: false },
    ]);
    expect(stalled.sql).toHaveBeenCalledOnce();
    expect(stalled.cancel).toHaveBeenCalledOnce();
    stalled.sql.mockImplementation(() => Object.assign(Promise.resolve([f.row]), { cancel: stalled.cancel }));
    expect(await probe()).toEqual({ ready: true });
  });
  it('rejects an app principal connected to a different database or server', async () => {
    const f = await fixture();
    for (const key of ['database', 'address', 'port', 'oid']) {
      const app = database(() => Promise.resolve([{ ...f.identity, [key]: 'different' }]));
      expect(await createReadiness({ ...options(f), app: app.db })()).toEqual({ ready: false });
    }
  });
  it('does not report ready with an invalid bundled migration catalog', async () => {
    const f = await fixture();
    await writeFile(
      join(f.migrationsDirectory, 'meta/_journal.json'),
      JSON.stringify({ entries: [{ idx: 0, when: 100, tag: '../../secret' }] }),
    );
    expect(await createReadiness(options(f))()).toEqual({ ready: false });
  });
});
