import { identityPost, type LoginResult, type MfaChallenge } from '../api/identity.ts';

const SSO_KEY = 'daifuku.oidc.flow';
let pendingChallenge: MfaChallenge | null = null;
let recoveryReceipt: string[] = [];
export function rememberMfa(challenge: MfaChallenge) {
  pendingChallenge = challenge;
}
export function takeMfa() {
  const result = pendingChallenge;
  pendingChallenge = null;
  return result;
}
export function rememberRecoveryCodes(codes: string[]) {
  recoveryReceipt = [...codes];
}
export function takeRecoveryCodes() {
  const result = recoveryReceipt;
  recoveryReceipt = [];
  return result;
}

/** Only the browser binding persists for the round trip; tokens and recovery codes do not. */
export async function startSso(providerId: string, stepUpToken?: string): Promise<void> {
  const browserNonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  sessionStorage.setItem(SSO_KEY, JSON.stringify({ providerId, browserNonce, createdAt: Date.now() }));
  try {
    const result = await identityPost<{ authorizationUrl: string }>(
      stepUpToken ? 'oidc/link' : 'oidc/start',
      { providerId, browserNonce, ...(stepUpToken ? { stepUpToken } : {}) },
      !stepUpToken,
    );
    const target = new URL(result.authorizationUrl);
    if (
      target.protocol !== 'https:' &&
      !(
        import.meta.env.DEV &&
        target.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
      )
    )
      throw new Error('Invalid authorization URL');
    window.location.assign(target.href);
  } catch (error) {
    sessionStorage.removeItem(SSO_KEY);
    throw error;
  }
}

export function readSsoReturn() {
  const search = new URLSearchParams(window.location.search);
  window.history.replaceState(window.history.state, '', window.location.pathname);
  const raw = sessionStorage.getItem(SSO_KEY);
  sessionStorage.removeItem(SSO_KEY);
  if (!raw || search.has('error')) return null;
  try {
    const saved = JSON.parse(raw) as { providerId?: unknown; browserNonce?: unknown; createdAt?: unknown };
    if (
      typeof saved.providerId !== 'string' ||
      typeof saved.browserNonce !== 'string' ||
      typeof saved.createdAt !== 'number' ||
      Date.now() - saved.createdAt > 600_000 ||
      saved.createdAt > Date.now()
    )
      return null;
    const code = search.get('code'),
      state = search.get('state');
    return code && state ? { providerId: saved.providerId, browserNonce: saved.browserNonce, code, state } : null;
  } catch {
    return null;
  }
}
export const completeSso = (input: NonNullable<ReturnType<typeof readSsoReturn>>) =>
  identityPost<LoginResult | { linked: true }>('oidc/complete', input, true);
export function readMailToken() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  window.history.replaceState(window.history.state, '', window.location.pathname);
  return token.length <= 512 ? token : '';
}
