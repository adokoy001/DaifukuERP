// Synthetic-only lifecycle runner. Database selection is independently checked by the fixture.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('..', import.meta.url));
const children = [];
const pnpmCli = process.env.npm_execpath;
const browserUrl = 'http://localhost:5189';
let interrupted;
let stopping;
if (
  !pnpmCli ||
  !process.env.TEST_DATABASE_URL_OWNER ||
  !process.env.TEST_DATABASE_URL ||
  process.env.E2E_IDENTITY_PREPARE !== '1'
)
  throw new Error(
    'Run pnpm test:identity:e2e with explicit empty fixture TEST database URLs and E2E_IDENTITY_PREPARE=1.',
  );
if (process.env.E2E_IDENTITY_BASE_URL && process.env.E2E_IDENTITY_BASE_URL !== browserUrl)
  throw new Error('Identity E2E browser URL must be the fixed local fixture origin.');
function start(args, env = {}) {
  if (interrupted) throw new Error('Identity fixture interrupted.');
  const child = spawn(process.execPath, [pnpmCli, ...args], {
    cwd,
    env: { ...process.env, ...env, E2E_IDENTITY_BASE_URL: browserUrl },
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  children.push(child);
  return child;
}
async function waitReady(url, child) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (interrupted || child.exitCode !== null || child.signalCode !== null)
      throw new Error('Synthetic fixture exited before readiness.');
    try {
      const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      /* still starting */
    }
    await new Promise((done) => globalThis.setTimeout(done, 500));
  }
  throw new Error('Synthetic fixture did not become ready.');
}
function alive(child) {
  if (!child.pid) return false;
  if (process.platform === 'win32') return child.exitCode === null && child.signalCode === null;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}
function signal(child, name) {
  try {
    if (process.platform === 'win32') child.kill(name);
    else if (child.pid) process.kill(-child.pid, name);
  } catch {
    /* group already exited */
  }
}
async function terminate(child) {
  if (!alive(child)) return;
  signal(child, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (alive(child) && Date.now() < deadline) await new Promise((done) => globalThis.setTimeout(done, 50));
  if (alive(child)) signal(child, 'SIGKILL');
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
}
function stop() {
  stopping ??= Promise.all([...children].reverse().map(terminate));
  return stopping;
}
for (const [name, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
])
  process.once(name, () => {
    interrupted = code;
    process.exitCode = code;
    void stop();
  });
async function assertPortsFree() {
  const { createServer } = await import('node:net');
  for (const port of [3109, 3110, 5189])
    await new Promise((done, reject) => {
      const socket = createServer();
      socket.once('error', () => reject(new Error('Identity fixture ports must be unused.')));
      socket.listen(port, '127.0.0.1', () => socket.close(done));
    });
}
try {
  await assertPortsFree();
  const api = start(['exec', 'tsx', 'apps/api/test/identity-e2e-server.ts']);
  await waitReady('http://127.0.0.1:3109/health', api);
  const web = start(
    ['--filter', '@daifuku/web', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5189', '--strictPort'],
    { VITE_API_URL: 'http://localhost:3109' },
  );
  await waitReady('http://127.0.0.1:5189/login', web);
  const test = start([
    '--filter',
    '@daifuku/web',
    'exec',
    'playwright',
    'test',
    '--config',
    'playwright.identity.config.ts',
  ]);
  const [code] = await once(test, 'exit');
  process.exitCode = interrupted ?? code ?? 1;
} catch {
  process.stderr.write('Identity E2E did not complete. Verify the dedicated empty database and local fixture ports.\n');
  process.exitCode = interrupted ?? 1;
} finally {
  await stop();
}
