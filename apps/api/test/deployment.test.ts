import { describe, expect, it } from 'vitest';
import fastify from 'fastify';
import { trustedProxyPeers } from '../src/deployment/proxy.ts';
import { readApiConfig } from '../src/config.ts';
describe('deployment proxy trust boundary', () => {
  it('rejects unrestricted or ambiguous peers and preserves explicit addresses', () => {
    expect(trustedProxyPeers(undefined)).toEqual([]);
    expect(trustedProxyPeers('127.0.0.1, ::1,127.0.0.1')).toEqual(['127.0.0.1', '::1']);
    expect(trustedProxyPeers('10.20.30.0/24')).toEqual(['10.20.30.0/24']);
    for (const value of ['true', '1', 'loopback', '*', '0.0.0.0/0', '::/0', 'example.com', '127.0.0.1/', '127.0.0.1/33', '127.0.0.1,', '127.0.0.1/32/x']) expect(() => trustedProxyPeers(value)).toThrow();
    expect(readApiConfig({ DATABASE_URL: 'synthetic', DATABASE_URL_OWNER: 'synthetic', JWT_SECRET: 'development', TRUSTED_PROXY_CIDRS: '127.0.0.1/32' }).trustedProxies).toEqual(['127.0.0.1/32']);
  });
  it('accepts the nearest forwarded address only from a configured proxy and ignores spoofed direct headers', async () => {
    const app = fastify({ trustProxy: [...trustedProxyPeers('127.0.0.1/32')] });
    app.get('/', (request) => ({ ip: request.ip }));
    try {
      const headers = { 'x-forwarded-for': '203.0.113.11, 198.51.100.2' };
      expect((await app.inject({ url: '/', remoteAddress: '127.0.0.1', headers })).json()).toEqual({ ip: '198.51.100.2' });
      expect((await app.inject({ url: '/', remoteAddress: '192.0.2.9', headers })).json()).toEqual({ ip: '192.0.2.9' });
    } finally { await app.close(); }
  });
});
