import { createHash } from 'node:crypto';
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { identityDenied, opaqueToken, tokenHash } from '@daifuku/kernel';
import type { IdentityOptions, OidcProvider } from './config.ts';
export interface OidcTransaction {
  providerId: string;
  browserHash: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  fingerprint: string;
  linking: boolean;
}
export const providerFingerprint = (p: OidcProvider): string => tokenHash(JSON.stringify(p));
export function authorizationRequest(
  provider: OidcProvider,
  options: IdentityOptions,
  state: string,
  browserNonce: string,
  linking: boolean,
) {
  const verifier = opaqueToken(),
    nonce = opaqueToken(),
    redirectUri = new URL('/auth/oidc/callback', options.webUrl).toString();
  const transaction: OidcTransaction = {
    providerId: provider.id,
    browserHash: tokenHash(browserNonce),
    nonce,
    verifier,
    redirectUri,
    fingerprint: providerFingerprint(provider),
    linking,
  };
  const url = new URL(provider.authorizationEndpoint);
  for (const [key, value] of Object.entries({
    client_id: provider.clientId,
    response_type: 'code',
    scope: 'openid email',
    redirect_uri: redirectUri,
    state,
    nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    ...(linking ? { prompt: 'login', max_age: '0' } : {}),
  }))
    url.searchParams.set(key, value);
  return { authorizationUrl: url.toString(), transaction };
}
async function boundedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 131072) throw identityDenied();
  const reader = response.body?.getReader();
  if (!reader) throw identityDenied();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 131072) throw identityDenied();
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
}
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function jwks(provider: OidcProvider) {
  const key = `${provider.id}:${provider.jwksUri}`;
  let resolver = keys.get(key);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(provider.jwksUri), {
      timeoutDuration: 5000,
      cooldownDuration: 30000,
      [customFetch]: boundedFetch,
    });
    keys.set(key, resolver);
  }
  return resolver;
}
export async function exchangeOidc(
  provider: OidcProvider,
  transaction: OidcTransaction,
  code: string,
  browserNonce: string,
  createdAt: Date,
): Promise<string> {
  if (
    transaction.providerId !== provider.id ||
    transaction.fingerprint !== providerFingerprint(provider) ||
    transaction.browserHash !== tokenHash(browserNonce)
  )
    throw identityDenied();
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: transaction.redirectUri,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code_verifier: transaction.verifier,
    });
    const response = await boundedFetch(provider.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    const tokens = (await response.json()) as { id_token?: unknown };
    if (typeof tokens.id_token !== 'string' || tokens.id_token.length > 16384) throw identityDenied();
    const { payload } = await jwtVerify(tokens.id_token, jwks(provider), {
      issuer: provider.issuer,
      audience: provider.clientId,
      algorithms: ['RS256', 'ES256'],
      requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce'],
      maxTokenAge: 600,
      clockTolerance: 5,
    });
    if (
      payload.nonce !== transaction.nonce ||
      !payload.sub ||
      payload.sub.length > 255 ||
      (payload.azp !== undefined && payload.azp !== provider.clientId) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== provider.clientId)
    )
      throw identityDenied();
    if (
      transaction.linking &&
      (typeof payload.auth_time !== 'number' || payload.auth_time < Math.floor(createdAt.getTime() / 1000) - 60)
    )
      throw identityDenied();
    return payload.sub;
  } catch {
    throw identityDenied();
  }
}
