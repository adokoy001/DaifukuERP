// Explicit opt-in local process acceptance. No host services, global CA trust or database changes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { request } from 'node:https';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { renderProfile } from '../profile.mjs';
import { verifyRelease } from '../files.mjs';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const WebSocket = require('ws');
const { values } = parseArgs({
  options: { release: { type: 'string' }, 'manifest-sha256': { type: 'string' }, caddy: { type: 'string' } },
});
if (!values.release || !values['manifest-sha256'] || !values.caddy)
  throw new Error('Specify --release, --manifest-sha256 and --caddy explicitly.');
await verifyRelease(values.release, values['manifest-sha256']);
const directory = await mkdtemp(join(tmpdir(), 'daifuku-gateway-acceptance-'));
const servers = [];
const children = [];
const sockets = new Set();
const clients = new Set();
const pause = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));
async function freePort() {
  const s = createServer();
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  const port = s.address().port;
  await new Promise((resolve) => s.close(resolve));
  return port;
}
function get(hostname, port, ca, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname,
        port,
        ca,
        path,
        headers,
        family: 4,
        lookup: (_name, _options, callback) => callback(null, '127.0.0.1', 4),
        timeout: 1500,
      },
      (response) => {
        let body = '';
        response.on('data', (part) => {
          body += part;
        });
        response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('HTTPS acceptance timeout')));
    req.end();
  });
}
async function upstream(instance) {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        instance,
        path: req.url,
        forwardedFor: req.headers['x-forwarded-for'],
        proto: req.headers['x-forwarded-proto'],
      }),
    );
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1')
      .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    assert.equal(req.url, '/relay/connect');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return server.address().port;
}
async function websocket(hostname, port, ca) {
  const socket = new WebSocket(`wss://${hostname}:${port}/api/relay/connect`, {
    ca,
    family: 4,
    lookup: (_name, _options, callback) => callback(null, '127.0.0.1', 4),
    handshakeTimeout: 2000,
  });
  clients.add(socket);
  socket.on('close', () => clients.delete(socket));
  await once(socket, 'open');
  return socket;
}
async function profile(kind, hostname, cert, key, ca) {
  const state = join(directory, kind);
  await mkdir(state, { mode: 0o700 });
  const port = await upstream(kind);
  const tlsPort = await freePort();
  const config = join(state, 'runtime.env');
  const output = join(directory, `${kind}-profile`);
  await writeFile(
    config,
    `NODE_ENV=production\nHOST=127.0.0.1\nPORT=${port}\nTRUSTED_PROXY_CIDRS=127.0.0.1/32\nDAIFUKU_STORAGE_DIR=${state}/evidence\nISOLATED_SYNTHETIC_VALUE=${kind}\n`,
    { mode: 0o600 },
  );
  await renderProfile({
    release: values.release,
    manifestHash: values['manifest-sha256'],
    state,
    config,
    output,
    node: process.execPath,
    user: userInfo().username,
    hostname,
    profile: kind,
    cert,
    key,
    execute: true,
    allowCandidate: true,
  });
  const generated = await readFile(join(output, 'Caddyfile'), 'utf8');
  // Only local test adaptations: ephemeral ports, shared test CA, no public ACME or global trust changes.
  let adapted = generated
    .replace('admin off', `admin off\n  auto_https disable_redirects`)
    .replace(`${hostname} {`, `https://${hostname}:${tlsPort} {`);
  if (kind === 'cloud')
    adapted = adapted.replace(
      `https://${hostname}:${tlsPort} {`,
      `https://${hostname}:${tlsPort} {\n  tls ${cert} ${key}`,
    );
  const file = join(output, 'Caddyfile.acceptance');
  await writeFile(file, adapted, { mode: 0o600 });
  const env = {
    PATH: process.env.PATH,
    HOME: state,
    XDG_DATA_HOME: join(state, 'caddy-data'),
    XDG_CONFIG_HOME: join(state, 'caddy-config'),
  };
  execFileSync(values.caddy, ['validate', '--config', file, '--adapter', 'caddyfile'], { env, stdio: 'pipe' });
  const child = spawn(values.caddy, ['run', '--config', file, '--adapter', 'caddyfile'], { env, stdio: 'pipe' });
  children.push(child);
  let stderr = '';
  child.stderr.on('data', (part) => {
    stderr += part;
  });
  let home;
  for (let i = 0; i < 50; i++) {
    try {
      home = await get(hostname, tlsPort, ca, '/');
      break;
    } catch {
      if (child.exitCode !== null) throw new Error('Caddy stopped before readiness');
      await pause(100);
    }
  }
  assert.equal(home?.status, 200);
  assert.equal(home.body, await readFile(join(values.release, 'web/index.html'), 'utf8'));
  assert.equal((await get(hostname, tlsPort, ca, '/workforce/shifts')).body, home.body);
  const response = await get(hostname, tlsPort, ca, '/api/health', { 'x-forwarded-for': '203.0.113.200' });
  assert.deepEqual(JSON.parse(response.body), {
    instance: kind,
    path: '/health',
    forwardedFor: '127.0.0.1',
    proto: 'https',
  });
  const connection = await websocket(hostname, tlsPort, ca);
  const closed = once(connection, 'close');
  assert.doesNotMatch(generated, /ISOLATED_SYNTHETIC_VALUE/);
  assert.doesNotMatch(stderr, /relay\/connect/);
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    pause(5000).then(() => {
      throw new Error('Caddy did not stop');
    }),
  ]);
  await closed;
  await assert.rejects(get(hostname, tlsPort, ca, '/'));
  return {
    profile: kind,
    tls: 'verified-local-test-ca',
    spa: true,
    apiPrefix: true,
    forwardedHeaderReplacement: true,
    websocketUpgrade: true,
    terminated: true,
  };
}
try {
  const cert = join(directory, 'test.crt');
  const key = join(directory, 'test.key');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      key,
      '-out',
      cert,
      '-subj',
      '/CN=Daifuku local acceptance',
      '-addext',
      'subjectAltName=DNS:cloud.example.test,DNS:onprem.example.test',
    ],
    { stdio: 'pipe' },
  );
  const ca = await readFile(cert);
  const results = [];
  for (const kind of ['cloud', 'onprem']) results.push(await profile(kind, `${kind}.example.test`, cert, key, ca));
  await verifyRelease(values.release, values['manifest-sha256']);
  process.stdout.write(
    JSON.stringify(
      {
        artifactUnchanged: true,
        results,
        directory,
        scope:
          'Local Caddy TLS/proxy process acceptance; synthetic HTTP/WS upstream; no production ACME or systemd service installation.',
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  for (const client of clients) client.terminate();
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  for (const socket of sockets) socket.destroy();
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
}
