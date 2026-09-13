import { request } from './client.ts';

export function changeOwnPassword(currentPassword: string, newPassword: string) {
  return request<{ ok: true }>('/auth/password', {
    method: 'POST',
    body: { currentPassword, newPassword },
    cache: 'no-store',
  });
}
export function logoutAllSessions() {
  return request<{ ok: true }>('/auth/logout-all', { method: 'POST', body: {}, cache: 'no-store' });
}
