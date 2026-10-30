// Company settings (web-phase1 AC-5, settings-console AC-4..AC-6): GET /meta/settings -> SettingMeta[];
// PUT /meta/settings/:key { value } and DELETE /meta/settings/:key -> SettingMeta; GET /meta/settings/:key/audit.
// The code pickers read accounts / warehouses through the ordinary REST list (the caller's own read permission).
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { request } from './client.ts';
import type {
  CodeList,
  CodeOption,
  ListResponse,
  RecordJson,
  SettingChange,
  SettingMeta,
  SettingWidget,
} from './types.ts';

export const settingsKey = ['settings'] as const;
export const settingHistoryKey = (key: string) => ['settings', 'history', key] as const;

export function useSettings(enabled = true): UseQueryResult<SettingMeta[]> {
  return useQuery({
    queryKey: settingsKey,
    queryFn: () => request<SettingMeta[]>('/meta/settings'),
    enabled,
    retry: false,
  });
}

function settingPath(key: string): string {
  return `/meta/settings/${encodeURIComponent(key)}`;
}

/** Replaces one setting in the cached list and drops its cached history (a new audit row exists). */
function storeSaved(qc: QueryClient, saved: SettingMeta): void {
  qc.setQueryData<SettingMeta[]>(settingsKey, (prev) => (prev ?? []).map((s) => (s.key === saved.key ? saved : s)));
  void qc.invalidateQueries({ queryKey: settingHistoryKey(saved.key) });
}

export function useSaveSetting(): UseMutationResult<SettingMeta, Error, { key: string; value: unknown }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      request<SettingMeta>(settingPath(key), { method: 'PUT', body: { value } }),
    onSuccess: (saved) => storeSaved(qc, saved),
  });
}

/** AC-11: removes the company's value (back to the module default). */
export function useResetSetting(): UseMutationResult<SettingMeta, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => request<SettingMeta>(settingPath(key), { method: 'DELETE' }),
    onSuccess: (saved) => storeSaved(qc, saved),
  });
}

/** AC-12: the latest changes of one setting, newest first; fetched when the history is opened. */
export function useSettingHistory(key: string, enabled: boolean): UseQueryResult<SettingChange[]> {
  return useQuery({
    queryKey: settingHistoryKey(key),
    queryFn: () => request<SettingChange[]>(`${settingPath(key)}/audit`),
    enabled,
    retry: false,
  });
}

type CodeWidget = Exclude<SettingWidget, 'textarea'>;

/** Account codes from active accounts, warehouse codes from every warehouse (code order, up to the API page limit). */
const CODE_SOURCES: Record<CodeWidget, { entity: string; where?: Record<string, unknown> }> = {
  'account-code': { entity: 'account', where: { isActive: true } },
  'warehouse-code': { entity: 'warehouse' },
};
export const CODE_OPTION_LIMIT = 500;

function codeOptions(rows: readonly RecordJson[]): CodeOption[] {
  return rows.flatMap((row) =>
    typeof row.code === 'string' ? [{ code: row.code, name: typeof row.name === 'string' ? row.name : '' }] : [],
  );
}

/** AC-10: the first CODE_OPTION_LIMIT codes and how many there are in all (a longer list is cut off). */
export function useCodeOptions(widget: CodeWidget): UseQueryResult<CodeList> {
  const source = CODE_SOURCES[widget];
  return useQuery({
    queryKey: ['settings', 'codes', widget],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ orderBy: 'code:asc', limit: String(CODE_OPTION_LIMIT), offset: '0' });
      if (source.where) params.set('where', JSON.stringify(source.where));
      const list = await request<ListResponse>(`/api/${source.entity}?${params.toString()}`, { signal });
      const options = codeOptions(list.items);
      return { options, total: Math.max(list.total, options.length) };
    },
    staleTime: 60_000,
    retry: false,
  });
}

/** AC-10: one stored code looked up by itself (same source and filter), for a code beyond a cut-off list; null = none. */
export function useCodeLookup(widget: CodeWidget, code: string, enabled: boolean): UseQueryResult<CodeOption | null> {
  const source = CODE_SOURCES[widget];
  return useQuery({
    queryKey: ['settings', 'codes', widget, 'lookup', code],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ limit: '1', offset: '0', where: JSON.stringify({ ...source.where, code }) });
      const list = await request<ListResponse>(`/api/${source.entity}?${params.toString()}`, { signal });
      return codeOptions(list.items)[0] ?? null;
    },
    enabled: enabled && code !== '',
    staleTime: 60_000,
    retry: false,
  });
}

/** AC-5: the page is for admin or the `settings` role (the API enforces the same). */
export function canEditSettings(roles: readonly string[] | undefined): boolean {
  return (roles ?? []).some((r) => r === 'admin' || r === 'settings');
}
