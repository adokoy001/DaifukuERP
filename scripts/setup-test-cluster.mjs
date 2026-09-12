// Opt-in acceptance fixture. Creates a NEW local cluster only; no existing DB/role is changed.
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const postgres = require('postgres');
function run(bin, name, args) {
  const result = spawnSync(join(bin, name), args, { encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error(`${name} failed; private cluster artifacts are preserved`);
}
async function main() {
  const { values } = parseArgs({ options: { directory: { type: 'string' }, bin: { type: 'string' }, port: { type: 'string' } } });
  const base = values.directory, bin = values.bin, port = Number(values.port);
  if (!base || !bin || !isAbsolute(base) || !isAbsolute(bin) || !/^[\w/.-]+$/.test(base) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use --directory /new/absolute/path --bin /postgres/bin --port 55443 (unoccupied port)');
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(port, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  await mkdir(base, { mode: 0o700 }); // EEXIST deliberately refuses every existing directory.
  const credentials = Object.fromEntries(['admin', 'owner', 'app'].map(key => [key, `D!${randomBytes(32).toString('base64url')}9a`]));
  const save = (name, body) => writeFile(join(base, name), body, { mode: 0o600, flag: 'wx' });
  await save('credentials.json', JSON.stringify(credentials));
  await save('admin-password', `${credentials.admin}\n`);
  run(bin, 'initdb', ['-D', join(base, 'data'), '--username=postgres', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', `--pwfile=${join(base, 'admin-password')}`, '--no-locale', '--encoding=UTF8']);
  await mkdir(join(base, 'socket'), { mode: 0o700 });
  run(bin, 'pg_ctl', ['-D', join(base, 'data'), '-l', join(base, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${join(base, 'socket')}`, '-w', 'start']);
  const address = `127.0.0.1:${port}`;
  const db = postgres(`postgres://postgres:${encodeURIComponent(credentials.admin)}@${address}/postgres`, { max: 1, onnotice: () => undefined });
  try {
    if ((await db`select current_setting('data_directory') as directory`)[0]?.directory !== join(base, 'data')) throw new Error('Unexpected cluster; no fixture roles were created');
    for (const [name, secret, bypass] of [['daifuku_setup_owner', credentials.owner, 'BYPASSRLS'], ['daifuku_app', credentials.app, 'NOBYPASSRLS']]) {
      // Names/flags are fixed; generated base64url password plus D!/9a contains no SQL quote.
      await db.unsafe(`CREATE ROLE "${name}" LOGIN NOCREATEDB NOCREATEROLE ${bypass} PASSWORD '${secret}'`);
    }
    const names = ['daifuku_setup_test', 'daifuku_setup_legacy', ...Array.from({ length: 12 }, (_, i) => `daifuku_setup_restore_${i + 1}`)];
    for (const name of names) await db.unsafe(`CREATE DATABASE "${name}" OWNER daifuku_setup_owner`);
    const owner = `postgres://daifuku_setup_owner:${encodeURIComponent(credentials.owner)}@${address}/daifuku_setup_test`;
    const app = `postgres://daifuku_app:${encodeURIComponent(credentials.app)}@${address}/daifuku_setup_test`;
    await save('test.env', `DATABASE_URL_OWNER=${owner}\nDATABASE_URL=${app}\nRESTORE_CHECK_URL=${owner.replace('/daifuku_setup_test', '/daifuku_setup_restore_1')}\n`);
  } finally { await db.end(); }
  process.stdout.write(`Dedicated test cluster ready. Protected SETUP_TEST_ENV_FILE: ${join(base, 'test.env')}\n`);
}
main().catch(error => { process.stderr.write(`Setup test fixture failed (${typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'OPERATION_FAILED'}). Existing databases were not reset; inspect the private fixture directory.\n`); process.exitCode = 1; });
