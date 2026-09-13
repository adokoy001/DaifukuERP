// Company settings (web-phase1 AC-5): GET /meta/settings -> SettingMeta[]; PUT /meta/settings/:key { value } -> SettingMeta.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { request } from './client.ts';
import type { SettingMeta } from './types.ts';

export const settingsKey = ['settings'] as const;

export function useSettings(enabled = true): UseQueryResult<SettingMeta[]> {
  return useQuery({
    queryKey: settingsKey,
    queryFn: () => request<SettingMeta[]>('/meta/settings'),
    enabled,
    retry: false,
  });
}

export function useSaveSetting(): UseMutationResult<SettingMeta, Error, { key: string; value: unknown }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      request<SettingMeta>(`/meta/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } }),
    onSuccess: (saved) =>
      qc.setQueryData<SettingMeta[]>(settingsKey, (prev) => (prev ?? []).map((s) => (s.key === saved.key ? saved : s))),
  });
}

/** AC-5: the page is for admin or the `settings` role (the API enforces the same). */
export function canEditSettings(roles: readonly string[] | undefined): boolean {
  return (roles ?? []).some((r) => r === 'admin' || r === 'settings');
}
