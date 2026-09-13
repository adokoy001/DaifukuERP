import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from '@daifuku/kernel';
export interface ReadinessOptions {
  owner: Database;
  app: Database;
  storageDirectory: string;
  migrationsDirectory?: string;
  timeoutMs?: number;
  cacheMs?: number;
}
export interface ReadinessResult {
  ready: boolean;
}
interface DatabaseIdentity {
  database: string;
  address: string | null;
  port: string | null;
  oid: string;
}
interface AppliedMigration extends DatabaseIdentity {
  hash: string;
  created_at: string;
}
const defaultMigrations = fileURLToPath(new URL('../../drizzle/migrations/', import.meta.url));
async function expectedMigrations(directory: string) {
  const data = JSON.parse(await readFile(resolve(directory, 'meta/_journal.json'), 'utf8')) as {
    entries?: { idx: number; when: number; tag: string }[];
  };
  if (!Array.isArray(data.entries) || !data.entries.length) throw new Error('Missing release migration catalog');
  return Promise.all(
    data.entries.map(async (entry, index) => {
      if (entry.idx !== index || !Number.isSafeInteger(entry.when) || !/^\d{4}_[a-zA-Z0-9_]+$/.test(entry.tag))
        throw new Error('Invalid release migration catalog');
      return {
        hash: createHash('sha256')
          .update(await readFile(resolve(directory, `${entry.tag}.sql`)))
          .digest('hex'),
        when: String(entry.when),
      };
    }),
  );
}
async function query<T>(pending: PromiseLike<T> & { cancel(): void }, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(pending),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            pending.cancel();
          } catch {
            /* Keep the public deadline result opaque. */
          }
          reject(new Error('Readiness deadline'));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function storageReady(directory: string): Promise<void> {
  const path = resolve(directory),
    info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (await realpath(path)) !== path ||
    (process.getuid && info.uid !== process.getuid()) ||
    info.mode & 0o077
  )
    throw new Error('Private evidence directory required');
  await access(path, constants.R_OK | constants.W_OK | constants.X_OK);
}
/** No tenant data, credentials or exception text crosses the public readiness boundary. */
export function createReadiness(options: ReadinessOptions): () => Promise<ReadinessResult> {
  const expected = expectedMigrations(options.migrationsDirectory ?? defaultMigrations).catch(() => null);
  let running: Promise<ReadinessResult> | undefined,
    cached: ReadinessResult = { ready: false },
    checked = 0;
  async function check(): Promise<ReadinessResult> {
    try {
      const timeout = options.timeoutMs ?? 2000;
      const [catalog, actual, app] = await Promise.all([
        expected,
        query(
          options.owner.sql<
            AppliedMigration[]
          >`select hash, created_at::text, current_database() as database, inet_server_addr()::text as address, inet_server_port()::text as port, (select oid::text from pg_database where datname = current_database()) as oid from drizzle.__drizzle_migrations order by created_at, id`,
          timeout,
        ),
        query(
          options.app.sql<
            DatabaseIdentity[]
          >`select current_database() as database, inet_server_addr()::text as address, inet_server_port()::text as port, (select oid::text from pg_database where datname = current_database()) as oid`,
          timeout,
        ),
        storageReady(options.storageDirectory),
      ]);
      if (
        !actual[0] ||
        !app[0] ||
        (['database', 'address', 'port', 'oid'] as const).some((key) => actual[0]?.[key] !== app[0]?.[key])
      )
        return { ready: false };
      if (
        !catalog ||
        actual.length !== catalog.length ||
        actual.some((row, i) => row.hash !== catalog[i]?.hash || row.created_at !== catalog[i]?.when)
      )
        return { ready: false };
      return { ready: true };
    } catch {
      return { ready: false };
    }
  }
  return async () => {
    if (running) return running;
    if (checked && Date.now() - checked < (options.cacheMs ?? 1000)) return cached;
    running = check()
      .then((result) => {
        cached = result;
        checked = Date.now();
        return result;
      })
      .finally(() => {
        running = undefined;
      });
    return running;
  };
}
