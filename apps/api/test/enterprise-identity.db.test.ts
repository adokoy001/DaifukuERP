import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identityMail, opaqueToken, totp, unseal, users } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import type { FastifyInstance } from 'fastify';
import type { JWTPayload } from 'jose';
import { buildServer } from '../src/server.ts';
import { oidcFixture } from './identity-oidc-helper.ts';
let db: TestDb, app: FastifyInstance, oidc: Awaited<ReturnType<typeof oidcFixture>>, token = '';
let codes: string[] = [];
const key = Buffer.alloc(32, 7).toString('base64');
const post = (path: string, body: unknown, auth = '') => app.inject({ method: 'POST', url: `/auth/${path}`, payload: body, ...(auth ? { headers: { authorization: `Bearer ${auth}`, 'x-company-id': 'stale-company-value' } } : {}) });
const login = () => post('login', { email: 'admin@example.com', password: 'password' });
const security = (auth: string) => app.inject({ method: 'GET', url: '/auth/security', headers: { authorization: `Bearer ${auth}` } });
async function stepup() { const result = await post('step-up', { currentPassword: 'password' }, token); expect(result.statusCode, result.body).toBe(200); return { stepUpToken: result.json<{ stepUpToken: string }>().stepUpToken }; }
async function start(link = false) {
  const browserNonce = opaqueToken(), step = link ? await stepup() : {};
  const result = await post(link ? 'oidc/link' : 'oidc/start', { providerId: 'fixture', browserNonce, ...step }, link ? token : '');
  expect(result.statusCode, result.body).toBe(200); return { browserNonce, authorizationUrl: result.json<{ authorizationUrl: string }>().authorizationUrl };
}
async function oidcComplete(input: Awaited<ReturnType<typeof start>>, claims: JWTPayload = {}) {
  return post('oidc/complete', { providerId: 'fixture', browserNonce: input.browserNonce, ...oidc.code(input.authorizationUrl, claims) });
}
beforeAll(async () => {
  db = await freshDb(); oidc = await oidcFixture();
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'synthetic-identity-jwt-secret', identity: { encryptionKey: key, webUrl: 'https://erp.example.com', allowLoopbackForTests: true, providers: [{ id: 'fixture', label: 'Test provider', tenantId: db.tenantId, issuer: oidc.issuer, clientId: 'fixture-client', clientSecret: 'fixture-secret', authorizationEndpoint: `${oidc.issuer}/authorize`, tokenEndpoint: `${oidc.issuer}/token`, jwksUri: `${oidc.issuer}/jwks` }] } });
  await app.ready(); token = (await login()).json<{ token: string }>().token;
});
afterAll(async () => { await app?.close(); await oidc?.close(); await db?.close(); });
describe('OIDC HTTP boundaries with real signed local ID tokens', () => {
  it('does not turn an email-matched external identity into an administrator or new account', async () => {
    const attempt = await oidcComplete(await start()); expect(attempt.statusCode).toBe(401);
    expect((await db.owner.drizzle.select().from(users))).toHaveLength(1);
  });
  it('binds link state to this browser, uses PKCE and revokes sessions on explicit account linking', async () => {
    const input = await start(true), grant = oidc.code(input.authorizationUrl);
    const url = new URL(input.authorizationUrl); expect(url.searchParams.get('code_challenge_method')).toBe('S256'); expect(url.searchParams.get('prompt')).toBe('login');
    const wrong = await post('oidc/complete', { providerId: 'fixture', browserNonce: opaqueToken(), ...grant }); expect(wrong.statusCode).toBe(401);
    const complete = await post('oidc/complete', { providerId: 'fixture', browserNonce: input.browserNonce, ...grant }); expect(complete.statusCode, complete.body).toBe(200); expect(complete.json()).toEqual({ linked: true });
    expect((await security(token)).statusCode).toBe(401);
    expect((await post('oidc/complete', { providerId: 'fixture', browserNonce: input.browserNonce, ...grant })).statusCode).toBe(401);
    const logged = await oidcComplete(await start()); expect(logged.statusCode, logged.body).toBe(200); token = logged.json<{ token: string }>().token;
  });
  it('rejects issuer, audience, expiry, nonce and authorized-party confusion', async () => {
    for (const claims of [{ iss: 'https://attacker.example' }, { aud: 'another-client' }, { exp: 1 }, { nonce: 'different' }, { aud: ['fixture-client', 'other-client'] }, { azp: 'other-client' }]) {
      const response = await oidcComplete(await start(), claims); expect(response.statusCode, JSON.stringify(claims)).toBe(401); expect(response.body).not.toContain('fixture-secret');
    }
  });
});
describe('MFA, invitation and reset HTTP boundaries', () => {
  it('keeps wrong current-password attempts recoverable and enables MFA only after a valid proof', async () => {
    const wrong = await post('step-up', { currentPassword: 'incorrect' }, token); expect(wrong.statusCode).toBe(400); expect((await security(token)).statusCode).toBe(200);
    const setup = await post('mfa/setup', await stepup(), token); expect(setup.statusCode, setup.body).toBe(200);
    const body = setup.json<{ setupToken: string; secret: string; otpauthUri: string }>();
    expect((await post('mfa/confirm', { setupToken: body.setupToken, code: 'bad' }, token)).statusCode).toBe(400);
    const confirmed = await post('mfa/confirm', { setupToken: body.setupToken, code: totp(body.secret, Math.floor(Date.now() / 30000)) }, token); expect(confirmed.statusCode, confirmed.body).toBe(200); codes = confirmed.json<{ recoveryCodes: string[] }>().recoveryCodes;
    expect(codes).toHaveLength(10); expect((await security(token)).statusCode).toBe(401);
  });
  it('issues no normal token before MFA and accepts each recovery code just once', async () => {
    const first = await login(); expect(first.statusCode).toBe(200); expect(first.json()).not.toHaveProperty('token'); expect(first.json()).toMatchObject({ mfaRequired: true });
    const challengeToken = first.json<{ challengeToken: string }>().challengeToken;
    expect((await security(challengeToken)).statusCode).toBe(401);
    const verified = await post('mfa/verify', { challengeToken, code: codes[0] }); expect(verified.statusCode, verified.body).toBe(200); token = verified.json<{ token: string }>().token;
    expect((await security(token)).json()).toMatchObject({ mfaEnabled: true, recoveryCodesRemaining: 9 });
    const next = (await login()).json<{ challengeToken: string }>(); expect((await post('mfa/verify', { challengeToken: next.challengeToken, code: codes[0] })).statusCode).toBe(400);
    const external = await oidcComplete(await start()); expect(external.json()).toMatchObject({ mfaRequired: true }); expect(external.json()).not.toHaveProperty('token');
  });
  it('returns identical reset request responses and leaves MFA enabled after a single-use password reset', async () => {
    const unknown = await post('password-reset/request', { email: 'unknown@example.com' }), known = await post('password-reset/request', { email: 'admin@example.com' });
    expect(known.json()).toEqual(unknown.json()); expect(known.json()).toEqual({ ok: true }); expect(known.headers['cache-control']).toBe('private, no-store');
    const [mail] = await db.owner.drizzle.select().from(identityMail); if (!mail) throw new Error('Missing synthetic mail');
    const payload = JSON.parse(unseal(mail.payloadCipher, key, `${mail.tenantId}:${mail.id}:mail`)) as { text: string };
    const link = payload.text.match(/https:\/\/erp\.example\.com\/[^\s]+/)?.[0]; if (!link) throw new Error('Missing reset link');
    const resetToken = new URLSearchParams(new URL(link).hash.slice(1)).get('token');
    const complete = await post('password-reset/complete', { token: resetToken, newPassword: 'new-password-value' }); expect(complete.statusCode, complete.body).toBe(200);
    expect((await post('password-reset/complete', { token: resetToken, newPassword: 'other-password-value' })).statusCode).toBe(401);
    expect((await security(token)).statusCode).toBe(401);
    expect((await db.owner.drizzle.select().from(users).where(eq(users.id, db.adminUserId)))[0]?.mfaEnabled).toBe(1);
    expect((await post('login', { email: 'admin@example.com', password: 'new-password-value' })).json()).toMatchObject({ mfaRequired: true });
  });
});
