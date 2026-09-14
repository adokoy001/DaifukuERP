// Synthetic HTTP inputs for the real production Web and Swagger assets. No database or real identity is used.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { registerOpenApi } = await tsImport('../../apps/api/src/plugins/openapi.ts', import.meta.url);
const { withPrintBar } = await tsImport('../../apps/web/src/lib/print.ts', import.meta.url);
const { problem } = await tsImport('../../modules/workforce/test/shift-fixture.ts', import.meta.url);

export const shiftProblem = problem();
export const chromium = webRequire('@playwright/test').chromium;
export const expect = webRequire('@playwright/test').expect;
const downloadHelper = transpileModule(
  await readFile(new URL('../../apps/web/src/lib/download.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ModuleKind.ES2022, target: ScriptTarget.ES2022 } },
).outputText;

export async function startFixture(origin, peerOrigin, workers) {
  const server = apiRequire('fastify')({ logger: false });
  await registerOpenApi(server);
  const calls = { login: 0, sso: 0, external: 0 };
  server.addHook('onRequest', async (request) => {
    if (request.url === '/external') calls.external++;
  });
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    tenantId: '00000000-0000-4000-8000-000000000002',
    email: 'csp@example.test',
    name: 'Synthetic CSP User',
    roles: ['admin'],
    tenantAdmin: true,
  };
  const company = { id: '00000000-0000-4000-8000-000000000003', name: 'Synthetic CSP Company', currency: 'JPY' };
  server.get('/health', async () => ({ ok: true }));
  server.get('/auth/oidc/providers', async () => ({ items: [{ id: 'synthetic', label: 'Synthetic IdP' }] }));
  server.post('/auth/oidc/start', async (request) => {
    assert.equal(request.body.providerId, 'synthetic');
    assert.match(request.body.browserNonce, /^[A-Za-z0-9_-]{43}$/);
    calls.sso++;
    return { authorizationUrl: `${peerOrigin}/identity` };
  });
  server.post('/auth/login', async (request) => {
    assert.deepEqual(request.body, { email: user.email, password: 'synthetic-password-only' });
    calls.login++;
    return { token: 'synthetic-token-only', user };
  });
  server.get('/auth/me', async () => ({ user, companyId: company.id, company }));
  server.get('/auth/companies', async () => ({ items: [company] }));
  server.get('/meta', async () => ({ entities: [], actions: [], modules: [], packs: [] }));
  server.get('/identity', async (_request, reply) => reply.type('text/html').send('<h1>Synthetic IdP</h1>'));
  server.get('/external', async (_request, reply) => {
    return reply.type('text/javascript').send('globalThis.externalScriptRan = true;');
  });
  server.get('/embed', async (_request, reply) =>
    reply.type('text/html').send(`<iframe src="${origin}/login" title="Untrusted parent"></iframe>`),
  );
  server.get('/fixture-download', async (_request, reply) =>
    reply.header('Content-Disposition', 'attachment; filename="synthetic.csv"').type('text/csv').send('amount\n42\n'),
  );
  const printHtml = withPrintBar(
    '<html><body><h1>Synthetic invoice</h1><script>globalThis.printInlineRan = true</script></body></html>',
    { print: 'Print', close: 'Close' },
    origin,
  );
  const qr = await webRequire('qrcode').toDataURL('otpauth://totp/Synthetic?secret=JBSWY3DPEHPK3PXP&issuer=Synthetic');
  server.get('/fixture', async (_request, reply) =>
    reply
      // A permissive upstream value must be overwritten by Caddy's deferred headers.
      .header('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval'")
      .header('X-Frame-Options', 'SAMEORIGIN')
      .type('text/html')
      .send(
        '<button id="print">Print document</button><button id="download">Download</button>' +
          '<button id="negative">Run rejected operations</button><img id="qr" alt="Synthetic QR">' +
          '<script src="/api/fixture.js" type="module"></script>',
      ),
  );
  server.get('/download-helper.js', async (_request, reply) => reply.type('text/javascript').send(downloadHelper));
  server.get('/fixture.js', async (_request, reply) =>
    reply.type('text/javascript').send(`
    import {showHtmlIn, saveBlob} from '/api/download-helper.js';
    globalThis.probe = { violations: [], inline: false, attribute: false, evaluated: false, workers: {} };
    document.addEventListener('securitypolicyviolation', (event) => probe.violations.push(event.effectiveDirective));
    document.getElementById('qr').src = ${JSON.stringify(qr)};
    for (const [name, url] of Object.entries(${JSON.stringify(workers)})) {
      const worker = new Worker(url, { type: 'module' });
      worker.onmessage = ({ data }) => { probe.workers[name] = data; worker.terminate(); };
      worker.onerror = () => { probe.workers[name] = { failed: true }; worker.terminate(); };
      worker.postMessage(name === 'pivot' ? {
        rows: [{site:'A', amount:'9007199254740993.01'}, {site:'A', amount:'0.09'}],
        config: {rows:[{field:'site'}], columns:[], measures:[{field:'amount',op:'sum'}]}
      } : { problem: ${JSON.stringify(shiftProblem)}, options: {seed: 42, iterations: 10} });
    }
    document.getElementById('print').addEventListener('click', () => {
      const child = window.open('', '_blank');
      showHtmlIn(child, ${JSON.stringify(printHtml)});
    });
    document.getElementById('download').addEventListener('click', async () => {
      const bytes = await (await fetch('/api/fixture-download')).blob();
      saveBlob(bytes, 'synthetic.csv');
    });
    document.getElementById('negative').addEventListener('click', async () => {
      const inline = document.createElement('script'); inline.textContent = 'globalThis.probe.inline = true';
      document.body.append(inline);
      const button = document.createElement('button'); button.setAttribute('onclick', 'globalThis.probe.attribute = true');
      document.body.append(button); button.click();
      try { eval('globalThis.probe.evaluated = true'); } catch { probe.evalRejected = true; }
      const script = document.createElement('script'); script.src = ${JSON.stringify(`${peerOrigin}/external`)};
      script.onerror = () => { probe.scriptRejected = true; }; document.body.append(script);
      try { await fetch(${JSON.stringify(`${peerOrigin}/external`)}); } catch { probe.fetchRejected = true; }
      const form = document.createElement('form'); form.method = 'post'; form.action = ${JSON.stringify(`${peerOrigin}/external`)};
      document.body.append(form); form.submit();
      const base = document.createElement('base'); base.href = ${JSON.stringify(peerOrigin)}; document.head.append(base);
      const object = document.createElement('object'); object.data = ${JSON.stringify(`${peerOrigin}/external`)};
      document.body.append(object);
    });
  `),
  );
  await server.listen({ host: '127.0.0.1', port: 0 });
  return { server, calls, port: server.server.address().port };
}
