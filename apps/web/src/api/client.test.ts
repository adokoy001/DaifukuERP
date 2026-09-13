import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, clearSession, getToken, getUser, onUnauthorized, request, setSession } from './client.ts';
import type { LoginUser } from './types.ts';

const user: LoginUser = {
  id: 'first-user',
  tenantId: 'test-tenant',
  name: 'Synthetic user',
  email: 'first@example.com',
  roles: [],
  defaultCompanyId: null,
};
const unauthorized = vi.fn();
function delayedUnauthorized() {
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  return () =>
    resolve(
      new Response(
        JSON.stringify({ error: { code: 'PERMISSION_DENIED', message: 'Expired', hint: 'Sign in again.' } }),
        { status: 401 },
      ),
    );
}

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  unauthorized.mockClear();
  onUnauthorized(unauthorized);
  setSession('old-session', user);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quality-foundation AC-3: session identity on delayed unauthorized responses', () => {
  it('preserves a new login when an old authenticated request completes with 401', async () => {
    const respond = delayedUnauthorized();
    const pending = request('/meta');
    setSession('new-session', { ...user, id: 'second-user' });
    respond();
    await expect(pending).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBe('new-session');
    expect(getUser()?.id).toBe('second-user');
    expect(unauthorized).not.toHaveBeenCalled();
  });
  it('clears the current session and routes to login when its own request gets 401', async () => {
    const respond = delayedUnauthorized();
    const pending = request('/meta');
    respond();
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();
    expect(getUser()).toBeNull();
    expect(unauthorized).toHaveBeenCalledOnce();
  });
  it('does not redirect a signed-out user again after a late old response', async () => {
    const respond = delayedUnauthorized();
    const pending = request('/meta');
    clearSession();
    respond();
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();
    expect(unauthorized).not.toHaveBeenCalled();
  });
});
