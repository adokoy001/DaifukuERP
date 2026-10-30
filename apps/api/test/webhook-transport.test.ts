// docs/specs/event-delivery.md AC-9 (timeout, no redirects, response limit, abort) and AC-13 (allow-list of resolved
// addresses, loopback only for loopback URLs with the flag) against a local HTTP receiver; no external network.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyAddress, webhookTransport, type ResolvedAddress } from '../src/events/webhook-transport.ts';

let server: Server;
let base: string;
const received: { url: string; headers: IncomingMessage['headers']; body: string }[] = [];
let handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => res.writeHead(204).end();

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => {
      received.push({ url: req.url ?? '', headers: req.headers, body });
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const request = (url: string, signal?: AbortSignal) => ({
  url,
  body: '{"hello":"world"}',
  headers: { 'content-type': 'application/json', 'daifuku-delivery-id': 'd-1' },
  ...(signal ? { signal } : {}),
});
const resolveTo =
  (...addresses: string[]) =>
  async (): Promise<ResolvedAddress[]> =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('address allow-list (AC-13)', () => {
  it('AC-13 only globally routable unicast is global; loopback is its own class; everything else is blocked', () => {
    for (const address of [
      '93.184.216.34',
      '8.8.8.8',
      '2606:4700::6810:84e5',
      '2a00:1450:4001:80b::200e',
      '::ffff:93.184.216.34',
    ])
      expect(classifyAddress(address), address).toBe('global');
    for (const address of ['127.0.0.1', '127.255.0.9', '::1', '::ffff:127.0.0.1'])
      expect(classifyAddress(address), address).toBe('loopback');
    for (const address of [
      '0.0.0.0',
      '0.1.2.3',
      '10.0.0.5',
      '100.64.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.8',
      '192.0.2.1',
      '192.88.99.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.19.255.255',
      '198.51.100.7',
      '203.0.113.9',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
      '::',
      '::ffff:a00:5',
      '::ffff:10.0.0.5',
      '::a00:5',
      '64:ff9b::a00:1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1%eth0',
      'ff02::1',
      '2001::1',
      '2001:0:4136:e378::1',
      '2001:db8::1',
      '2002:a00:5::1',
      '3fff::1',
      'not-an-address',
    ])
      expect(classifyAddress(address), address).toBe('blocked');
  });

  it('AC-13 a DNS name resolving to any blocked address is dead (blocked_destination) without connecting', async () => {
    for (const address of [
      '::ffff:127.0.0.1',
      '::ffff:a00:5',
      '64:ff9b::a00:1',
      '0.1.2.3',
      '198.18.0.1',
      '10.0.0.5',
      '2002::1',
    ]) {
      const transport = webhookTransport({ allowLoopback: true, resolve: resolveTo(address) });
      expect(await transport.send(request('https://hooks.example.com/x')), address).toEqual({
        ok: false,
        code: 'blocked_destination',
      });
    }
    const mixed = webhookTransport({ allowLoopback: false, resolve: resolveTo('93.184.216.34', '10.0.0.5') });
    expect(await mixed.send(request('https://hooks.example.com/x'))).toMatchObject({ code: 'blocked_destination' });
  });

  it('AC-13 a DNS name resolving to 127.0.0.1 is dead even with the loopback flag on', async () => {
    const before = received.length;
    const transport = webhookTransport({ allowLoopback: true, resolve: resolveTo('127.0.0.1') });
    expect(await transport.send(request('https://hooks.example.com/x'))).toEqual({
      ok: false,
      code: 'blocked_destination',
    });
    expect(received.length).toBe(before);
  });

  it('AC-13 a loopback URL is sent with the flag on and dead with it off', async () => {
    const on = webhookTransport({ allowLoopback: true });
    expect(await on.send(request(`${base}/hook?x=1`))).toEqual({ ok: true, status: 204 });
    expect(received.at(-1)).toMatchObject({ url: '/hook?x=1', body: '{"hello":"world"}' });
    expect(received.at(-1)?.headers['daifuku-delivery-id']).toBe('d-1');
    const before = received.length;
    const off = webhookTransport({ allowLoopback: false });
    expect(await off.send(request(`${base}/hook`))).toEqual({ ok: false, code: 'blocked_destination' });
    expect(received.length).toBe(before);
  });

  it('AC-13 URLs that could not have been stored are refused (plain http to a DNS name, IP literals, user info)', async () => {
    const transport = webhookTransport({ allowLoopback: true, resolve: resolveTo('93.184.216.34') });
    for (const url of ['http://hooks.example.com/', 'https://10.0.0.5/', 'https://u:p@hooks.example.com/', 'nope'])
      expect(await transport.send(request(url)), url).toMatchObject({ code: 'blocked_destination' });
  });

  it('AC-9 a name that does not resolve is a network failure', async () => {
    const transport = webhookTransport({
      allowLoopback: false,
      resolve: async () => {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      },
    });
    expect(await transport.send(request('https://hooks.example.com/x'))).toEqual({ ok: false, code: 'network' });
  });
});

describe('HTTP behaviour (AC-9)', () => {
  const transport = webhookTransport({ allowLoopback: true, timeoutMs: 300, maxResponseBytes: 1024 });

  it('AC-9 a 3xx is a redirect failure and is not followed', async () => {
    handler = (_req, res) => res.writeHead(302, { location: `${base}/elsewhere` }).end();
    const before = received.length;
    expect(await transport.send(request(`${base}/hook`))).toEqual({ ok: false, code: 'redirect', status: 302 });
    expect(received.length).toBe(before + 1);
    expect(received.at(-1)?.url).toBe('/hook');
  });

  it('AC-9 other non-2xx statuses are http_status failures with the status code', async () => {
    handler = (_req, res) => res.writeHead(500).end('nope');
    expect(await transport.send(request(`${base}/hook`))).toEqual({ ok: false, code: 'http_status', status: 500 });
  });

  it('AC-9 a receiver slower than the limit is a timeout', async () => {
    handler = (_req, res) => setTimeout(() => res.writeHead(200).end(), 1000);
    expect(await transport.send(request(`${base}/slow`))).toEqual({ ok: false, code: 'timeout' });
  });

  it('AC-9 at most the response limit is read; a large 2xx body is still delivered', async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      res.write('x'.repeat(4096));
      // Never ends: the adapter must stop reading after the limit instead of waiting for the end.
    };
    expect(await transport.send(request(`${base}/big`))).toEqual({ ok: true, status: 200 });
  });

  it('AC-1 an external abort (shutdown) stops an in-flight request', async () => {
    handler = (_req, res) => setTimeout(() => res.writeHead(200).end(), 2000);
    const controller = new AbortController();
    const slow = webhookTransport({ allowLoopback: true, timeoutMs: 5000 });
    const pending = slow.send(request(`${base}/slow`, controller.signal));
    setTimeout(() => controller.abort(), 50);
    const started = Date.now();
    expect(await pending).toMatchObject({ ok: false });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('AC-9 a connection failure is a network failure', async () => {
    const closed = webhookTransport({ allowLoopback: true });
    expect(await closed.send(request('http://127.0.0.1:1/hook'))).toEqual({ ok: false, code: 'network' });
  });
});
