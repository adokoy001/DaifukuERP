import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCompanyId, getUser, isApiError, request } from './client.ts';
import type { AppMeta, ListResponse } from './types.ts';

export function financeIdentity() { const user = getUser(); return `${user?.tenantId ?? ''}:${user?.id ?? ''}:${getCompanyId() ?? ''}`; }

export function useFinanceAccess() {
  return useQuery({ queryKey: ['finance-access', financeIdentity()], queryFn: ({ signal }) => request<AppMeta>('/meta', { signal, cache: 'no-store' }), retry: false, staleTime: 0, gcTime: 0, refetchInterval: 15_000, refetchOnWindowFocus: 'always', networkMode: 'always' });
}

export function useFinanceRead<T>(action: string, input: Record<string, unknown>, enabled: boolean, parse: (raw: unknown) => T) {
  return useQuery({ queryKey: ['finance', financeIdentity(), action, input], queryFn: async ({ signal }) => parse(await request<unknown>('/actions/' + action, { method: 'POST', body: input, signal, cache: 'no-store' })), enabled, retry: false, staleTime: 0, gcTime: 0, refetchInterval: 15_000, refetchOnWindowFocus: 'always', networkMode: 'always' });
}

export function useFinanceList(entity: string, where: Record<string, unknown>, enabled: boolean, offset = 0) {
  const params = new URLSearchParams({ where: JSON.stringify(where), limit: '100', offset: String(offset) });
  return useQuery({ queryKey: ['finance', financeIdentity(), 'list', entity, where, offset], queryFn: ({ signal }) => request<ListResponse>(`/api/${entity}?${params}`, { signal, cache: 'no-store' }), enabled, retry: false, staleTime: 0, gcTime: 0, refetchInterval: 15_000, refetchOnWindowFocus: 'always', networkMode: 'always' });
}

export function useFinanceCommand<T = unknown>() {
  const qc = useQueryClient(), identity = financeIdentity();
  return useMutation({ mutationKey: ['finance-command', identity], gcTime: 0, retry: false, networkMode: 'always', mutationFn: async ({ action, input }: { action: string; input: unknown }) => {
    if (financeIdentity() !== identity) throw new Error('会社または利用者が変わりました。開き直してください。 / Reopen this workspace after switching company or user.');
    const result = await request<T>('/actions/' + action, { method: 'POST', body: input, cache: 'no-store' });
    if (financeIdentity() !== identity) throw new Error('会社または利用者が変わりました。結果は元の会社で確認してください。 / Check the result in the original company.');
    return result;
  }, onSuccess: async () => { await Promise.all([qc.invalidateQueries({ queryKey: ['finance'] }), qc.invalidateQueries({ queryKey: ['list'] }), qc.invalidateQueries({ queryKey: ['record'] })]); }, onError: async (error) => {
    if (isApiError(error) && [401, 403, 404].includes(error.status)) await Promise.all([qc.resetQueries({ queryKey: ['finance'] }), qc.resetQueries({ queryKey: ['finance-access'] }), qc.invalidateQueries({ queryKey: ['meta'] })]);
  } });
}
