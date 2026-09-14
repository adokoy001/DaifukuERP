// Actual Caddy + compiled Web acceptance. TLS trusts a new local CA in an isolated browser home, never an ignore flag.
// The HTTP fixture is synthetic; actual authentication/business persistence remain covered by their separate E2E jobs.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { request } from 'node:https';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { digest, inventory } from '../files.mjs';
import { renderProfile } from '../profile.mjs';
import { chromium, expect, startFixture } from './browser-security-fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const caddy = process.env.CADDY_BIN ?? 'caddy';
const certutil = process.env.CERTUTIL_BIN ?? 'certutil';
const artifacts = resolve(process.env.CSP_ARTIFACT_DIR ?? join(root, 'apps/web/test-results/browser-security'));

function caddyEnvironment(temp) {
  return {
    ...process.env,
    HOME: join(temp, 'caddy-home'),
    XDG_CONFIG_HOME: join(temp, 'caddy-config'),
    XDG_DATA_HOME: join(temp, 'caddy-data'),
  };
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

function tlsGet(port, ca, path = '/api/health') {
  return new Promise((resolveResponse, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        servername: 'erp.example.test',
        ca,
        headers: { Host: 'erp.example.test' },
        path,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (part) => {
          body += part;
        });
        res.on('end', () => resolveResponse({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('TLS response timeout')));
    req.end();
  });
}

async function certificates(temp) {
  const ca = join(temp, 'ca.crt');
  const cert = join(temp, 'site.crt');
  const key = join(temp, 'site.key');
  const openssl = (args) => execFileSync('openssl', args, { stdio: 'ignore' });
  openssl([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '2',
    '-subj',
    '/CN=Daifuku synthetic CSP CA',
    '-keyout',
    join(temp, 'ca.key'),
    '-out',
    ca,
    '-addext',
    'basicConstraints=critical,CA:TRUE',
  ]);
  openssl([
    'req',
    '-new',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=erp.example.test',
    '-keyout',
    key,
    '-out',
    join(temp, 'site.csr'),
  ]);
  const extensions = join(temp, 'extensions.cnf');
  await writeFile(
    extensions,
    'subjectAltName=DNS:erp.example.test,DNS:peer.example.test\nextendedKeyUsage=serverAuth\n',
  );
  openssl([
    'x509',
    '-req',
    '-in',
    join(temp, 'site.csr'),
    '-CA',
    ca,
    '-CAkey',
    join(temp, 'ca.key'),
    '-CAcreateserial',
    '-days',
    '2',
    '-out',
    cert,
    '-extfile',
    extensions,
  ]);
  const browserHome = join(temp, 'browser-home');
  const trust = join(browserHome, '.pki/nssdb');
  await mkdir(trust, { recursive: true });
  execFileSync(certutil, ['-N', '-d', `sql:${trust}`, '--empty-password'], { stdio: 'ignore' });
  execFileSync(certutil, ['-A', '-d', `sql:${trust}`, '-n', 'Daifuku synthetic CSP CA', '-t', 'C,,', '-i', ca], {
    stdio: 'ignore',
  });
  return { ca: await readFile(ca), cert, key, browserHome };
}

async function releaseFixture(temp) {
  const release = join(temp, 'release');
  await mkdir(release);
  await cp(join(root, 'apps/web/dist'), join(release, 'web'), { recursive: true });
  const html = await readFile(join(release, 'web/index.html'), 'utf8');
  assert.match(html, /\/assets\/.*\.js/);
  assert.doesNotMatch(html, /\/src\/main|@vite\/client/);
  const assets = await readdir(join(release, 'web/assets'));
  const worker = (name) => {
    const value = assets.find((path) => path.startsWith(name) && path.endsWith('.js'));
    assert.ok(value, `Compiled worker missing: ${name}`);
    return `/assets/${value}`;
  };
  const body = JSON.stringify({
    format: 1,
    candidate: true,
    platform: 'linux',
    arch: process.arch,
    node: process.version,
    commit: 'a'.repeat(40),
    apiBase: '/api',
    files: await inventory(release),
  });
  await writeFile(join(release, 'manifest.json'), body);
  return {
    release,
    manifestHash: digest(body),
    workers: { pivot: worker('pivot-worker-'), shift: worker('shift.worker-') },
  };
}

async function profileFixture(temp, profile, release, tls, port, httpsPort, httpPort) {
  const state = join(temp, `${profile}-state`);
  const output = join(temp, `${profile}-profile`);
  await mkdir(state, { mode: 0o700 });
  const config = join(state, 'runtime.env');
  await writeFile(
    config,
    `NODE_ENV=production\nHOST=127.0.0.1\nPORT=${port}\nTRUSTED_PROXY_CIDRS=127.0.0.1/32\nDAIFUKU_STORAGE_DIR=${state}/evidence\n`,
    { mode: 0o600 },
  );
  await renderProfile({
    ...release,
    state,
    config,
    output,
    node: process.execPath,
    user: userInfo().username,
    hostname: 'erp.example.test',
    profile,
    cert: tls.cert,
    key: tls.key,
    allowCandidate: true,
    execute: true,
  });
  const generated = await readFile(join(output, 'Caddyfile'), 'utf8');
  // Only test transport changes: unprivileged ports and fixture-issued certificates in place of public ACME.
  // The generated security headers, routing, forwarded headers and cache controls are retained verbatim.
  let local = generated.replace('admin off', `admin off\n  http_port ${httpPort}\n  https_port ${httpsPort}`);
  if (profile === 'cloud')
    local = local.replace('erp.example.test {', `erp.example.test {\n  tls ${tls.cert} ${tls.key}`);
  local += `\npeer.example.test {\n  tls ${tls.cert} ${tls.key}\n  reverse_proxy 127.0.0.1:${port}\n}\n`;
  const configPath = join(output, 'Caddyfile.acceptance');
  await writeFile(configPath, local);
  execFileSync(caddy, ['validate', '--config', configPath, '--adapter', 'caddyfile'], {
    stdio: 'pipe',
    env: caddyEnvironment(temp),
  });
  return configPath;
}

async function verifyBrowser(context, origin, peerOrigin, calls) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/login`);
  await page.locator('#email').fill('csp@example.test');
  await page.locator('#password').fill('synthetic-password-only');
  await page.locator('form[aria-label="ログイン"] button[type="submit"]').click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect(page.getByText('Synthetic CSP Company', { exact: true }).first()).toBeVisible();
  assert.equal(calls.login, 1);
  await page.goto(`${origin}/workspaces`);
  await expect(page.locator('main')).toBeVisible();
  const docs = await page.goto(`${origin}/api/docs`);
  assert.equal(docs.status(), 200);
  await expect(page).toHaveURL(`${origin}/api/docs/`);
  await expect(page.locator('.swagger-ui .info .title')).toContainText('Daifuku API');
  await expect(page.locator('.opblock').first()).toBeVisible();
  await page.goto(`${origin}/api/fixture`);
  await expect.poll(() => page.evaluate(() => Object.keys(globalThis.probe.workers).length)).toBe(2);
  const workers = await page.evaluate(() => globalThis.probe.workers);
  assert.equal(workers.pivot.kind, 'result');
  assert.equal(workers.pivot.result.rowCount, 2);
  assert.ok(Object.values(workers.pivot.result.cells).some((cell) => cell[0] === '9007199254740993.1'));
  assert.equal(workers.shift.kind, 'result');
  assert.equal(workers.shift.result.assignments.length, 1);
  await expect.poll(() => page.locator('#qr').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  const popupPromise = page.waitForEvent('popup');
  const popupMessages = [];
  const observePopup = (child) => child.on('console', (message) => popupMessages.push(message.text()));
  context.on('page', observePopup);
  await page.locator('#print').click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/^blob:/);
  await popup.waitForLoadState();
  assert.equal(await popup.evaluate(() => globalThis.opener), null);
  assert.equal(await popup.evaluate(() => globalThis.printInlineRan), undefined);
  assert.ok(popupMessages.some((message) => message.includes('script-src') && message.includes('inline')));
  await expect(popup.getByRole('heading')).toHaveText('Synthetic invoice');
  // beforeprint is emitted by the browser's actual window.print(), not by replacing that function in DevTools.
  await popup.evaluate(() =>
    globalThis.addEventListener('beforeprint', () => {
      globalThis.printObserved = true;
    }),
  );
  await popup.getByRole('button', { name: 'Print', exact: true }).click();
  await expect.poll(() => popup.evaluate(() => globalThis.printObserved === true)).toBe(true);
  // The real handler closes this target; observe closure instead of waiting for navigation on a closed page.
  await Promise.all([
    popup.waitForEvent('close', { timeout: 10_000 }),
    popup.getByRole('button', { name: 'Close', exact: true }).click({ noWaitAfter: true }),
  ]);
  assert.equal(popup.isClosed(), true);
  assert.equal(page.isClosed(), false);
  context.off('page', observePopup);
  const downloaded = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await downloaded;
  assert.equal(download.suggestedFilename(), 'synthetic.csv');
  assert.equal(await readFile(await download.path(), 'utf8'), 'amount\n42\n');
  // All rejected operations run inside a served same-origin script. DevTools is used only to read results.
  // A CSP-rejected form schedules then cancels a navigation; wait for violations instead of a navigation event.
  await page.locator('#negative').click({ noWaitAfter: true });
  await expect
    .poll(() => page.evaluate(() => globalThis.probe.scriptRejected && globalThis.probe.fetchRejected))
    .toBe(true);
  await expect.poll(() => page.evaluate(() => globalThis.probe.violations.length)).toBeGreaterThanOrEqual(7);
  const probe = await page.evaluate(() => globalThis.probe);
  assert.equal(probe.inline, false);
  assert.equal(probe.attribute, false);
  assert.equal(probe.evaluated, false);
  assert.equal(probe.evalRejected, true);
  for (const directive of [
    'script-src-elem',
    'script-src-attr',
    'script-src',
    'connect-src',
    'form-action',
    'base-uri',
    'object-src',
  ])
    assert.ok(probe.violations.includes(directive), `Missing blocked directive: ${directive}`);
  assert.equal(calls.external, 0);
  const frame = await context.newPage();
  const frameMessages = [];
  frame.on('console', (message) => frameMessages.push(message.text()));
  await frame.goto(`${peerOrigin}/embed`);
  await expect.poll(() => frameMessages.some((message) => message.includes('frame-ancestors'))).toBe(true);
  await frame.close();
  await page.goto(`${origin}/login`);
  await page.getByRole('button', { name: 'Synthetic IdP', exact: true }).click();
  await expect(page).toHaveURL(`${peerOrigin}/identity`);
  await expect(page.getByRole('heading')).toHaveText('Synthetic IdP');
  assert.equal(calls.sso, 1);
  assert.deepEqual(errors, []);
  await page.close();
  return {
    workers: ['pivot', 'shift'],
    negativeDirectives: [...new Set(probe.violations)],
    login: calls.login,
    sso: calls.sso,
  };
}

test(
  'AC-1/AC-2: generated cloud and onprem profiles enforce CSP without breaking production browser features',
  { timeout: 240_000 },
  async () => {
    if (process.platform !== 'linux')
      throw new Error('This acceptance uses Linux Caddy and an isolated NSS trust store.');
    await mkdir(artifacts, { recursive: true });
    const temp = await mkdtemp(join(tmpdir(), 'daifuku-csp-'));
    const result = [];
    try {
      const tls = await certificates(temp);
      const release = await releaseFixture(temp);
      const browser = await chromium.launch({
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {}),
        env: { ...process.env, HOME: tls.browserHome, XDG_CONFIG_HOME: join(tls.browserHome, '.config') },
        args: ['--host-resolver-rules=MAP *.example.test 127.0.0.1', '--no-proxy-server'],
      });
      try {
        for (const profile of ['cloud', 'onprem']) {
          const httpsPort = await freePort();
          const httpPort = await freePort();
          const origin = `https://erp.example.test:${httpsPort}`;
          const peerOrigin = `https://peer.example.test:${httpsPort}`;
          const fixture = await startFixture(origin, peerOrigin, release.workers);
          let proxy;
          let log = '';
          try {
            const config = await profileFixture(temp, profile, release, tls, fixture.port, httpsPort, httpPort);
            proxy = spawn(caddy, ['run', '--config', config, '--adapter', 'caddyfile'], {
              stdio: ['ignore', 'pipe', 'pipe'],
              env: caddyEnvironment(temp),
            });
            proxy.stdout.on('data', (part) => {
              log += part.toString();
            });
            proxy.stderr.on('data', (part) => {
              log += part.toString();
            });
            await expect
              .poll(
                async () => {
                  try {
                    return (await tlsGet(httpsPort, tls.ca)).status;
                  } catch {
                    return 0;
                  }
                },
                { timeout: 15_000 },
              )
              .toBe(200);
            // The same TLS endpoint must fail without our CA, proving trust is active rather than bypassed.
            await assert.rejects(tlsGet(httpsPort, undefined));
            const response = await tlsGet(httpsPort, tls.ca, '/api/fixture');
            assert.match(response.headers['content-security-policy'], /script-src 'self'; script-src-attr 'none'/);
            assert.doesNotMatch(response.headers['content-security-policy'], /unsafe-eval/);
            assert.equal(response.headers['x-frame-options'], 'DENY');
            assert.equal(response.headers['strict-transport-security'], 'max-age=31536000');
            assert.equal(response.headers['x-content-type-options'], 'nosniff');
            assert.equal(response.headers['referrer-policy'], 'no-referrer');
            assert.equal(
              (await tlsGet(httpsPort, tls.ca, release.workers.pivot)).headers['cache-control'],
              'public, max-age=31536000, immutable',
            );
            assert.equal((await tlsGet(httpsPort, tls.ca, '/workspaces')).headers['cache-control'], 'no-cache');
            const context = await browser.newContext({ locale: 'ja-JP', acceptDownloads: true });
            try {
              result.push({
                profile,
                tlsVerified: true,
                ...(await verifyBrowser(context, origin, peerOrigin, fixture.calls)),
              });
            } finally {
              await context.close();
            }
          } finally {
            if (proxy && proxy.exitCode === null) {
              const exited = once(proxy, 'exit', { signal: globalThis.AbortSignal.timeout(10_000) });
              proxy.kill('SIGTERM');
              try {
                await exited;
              } catch {
                const killed = once(proxy, 'exit');
                proxy.kill('SIGKILL');
                await killed;
              }
            }
            await fixture.server.close();
            await writeFile(join(artifacts, `${profile}-caddy.log`), log);
          }
        }
      } finally {
        await browser.close();
      }
      await writeFile(join(artifacts, 'result.json'), JSON.stringify(result, null, 2));
      assert.equal(result.length, 2);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  },
);
