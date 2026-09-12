import { request } from './client.ts';
import type { LoginResponse } from './types.ts';

export interface MfaChallenge { mfaRequired: true; challengeToken: string; expiresIn: number }
export type LoginResult = LoginResponse | MfaChallenge;
export interface IdentityProvider { id: string; label: string }
export interface SecurityInfo { mfaEnabled: boolean; recoveryCodesRemaining: number; identities: { providerId: string; issuer: string }[]; configured: boolean }
export interface MfaSetup { setupToken: string; secret: string; otpauthUri: string; expiresIn: number }
export const identityPost = <T>(path: string, body: unknown, anonymous = false) => request<T>(`/auth/${path}`, { method: 'POST', body, anonymous, cache: 'no-store' });
export const identityProviders = () => request<{ items: IdentityProvider[] }>('/auth/oidc/providers', { anonymous: true, cache: 'no-store' });
export const accountSecurity = (signal?: AbortSignal) => request<SecurityInfo>('/auth/security', { ...(signal ? { signal } : {}), cache: 'no-store' });
export const stepUp = (currentPassword: string, code?: string) => identityPost<{ stepUpToken: string; expiresIn: number }>('step-up', { currentPassword, ...(code ? { code } : {}) });
export const verifyMfa = (challengeToken: string, code: string) => identityPost<LoginResponse>('mfa/verify', { challengeToken, code }, true);
