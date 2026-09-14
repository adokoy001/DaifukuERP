import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
export async function oidcFixture(options: { port?: number; webUrl?: string; inbox?: () => string[] } = {}) {
  const pair = await generateKeyPair('RS256');
  const publicKey = await exportJWK(pair.publicKey);
  const grants = new Map<string, { nonce: string; challenge: string; redirect: string; claims: JWTPayload }>();
  let issuer = '';
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    const requested = new URL(request.url ?? '/', 'http://fixture');
    if (requested.pathname === '/fixture/inbox' && options.inbox) {
      response.end(JSON.stringify({ messages: options.inbox() }));
      return;
    }
    if (requested.pathname === '/authorize' && options.webUrl) {
      const target = requested.searchParams.get('redirect_uri');
      if (
        target !== `${options.webUrl}/auth/oidc/callback` ||
        requested.searchParams.get('client_id') !== 'fixture-client'
      ) {
        response.statusCode = 400;
        response.end('{}');
        return;
      }
      const code = `browser-${Date.now()}-${Math.random()}`;
      grants.set(code, {
        nonce: requested.searchParams.get('nonce') ?? '',
        challenge: requested.searchParams.get('code_challenge') ?? '',
        redirect: target,
        claims: {},
      });
      const redirect = new URL(target);
      redirect.searchParams.set('code', code);
      redirect.searchParams.set('state', requested.searchParams.get('state') ?? '');
      response.writeHead(302, { location: redirect.toString() });
      response.end();
      return;
    }
    if (request.url === '/jwks') {
      response.end(JSON.stringify({ keys: [{ ...publicKey, kid: 'fixture', alg: 'RS256', use: 'sig' }] }));
      return;
    }
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const input = new URLSearchParams(body);
    const grant = grants.get(input.get('code') ?? '');
    if (
      !grant ||
      input.get('grant_type') !== 'authorization_code' ||
      input.get('client_id') !== 'fixture-client' ||
      input.get('client_secret') !== 'fixture-secret' ||
      input.get('redirect_uri') !== grant.redirect ||
      createHash('sha256')
        .update(input.get('code_verifier') ?? '')
        .digest('base64url') !== grant.challenge
    ) {
      response.statusCode = 400;
      response.end('{}');
      return;
    }
    grants.delete(input.get('code') ?? '');
    const issued = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({
      iss: issuer,
      aud: 'fixture-client',
      sub: 'external-subject',
      nonce: grant.nonce,
      iat: issued,
      exp: issued + 300,
      auth_time: issued,
      email: 'admin@example.com',
      email_verified: true,
      ...grant.claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .sign(pair.privateKey);
    response.end(JSON.stringify({ id_token: jwt }));
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  issuer = `http://127.0.0.1:${address.port}`;
  return {
    issuer,
    code(authorizationUrl: string, claims: JWTPayload = {}) {
      const url = new URL(authorizationUrl);
      const code = `code-${grants.size}-${Date.now()}-${Math.random()}`;
      grants.set(code, {
        nonce: url.searchParams.get('nonce') ?? '',
        challenge: url.searchParams.get('code_challenge') ?? '',
        redirect: url.searchParams.get('redirect_uri') ?? '',
        claims,
      });
      return { code, state: url.searchParams.get('state') ?? '' };
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
