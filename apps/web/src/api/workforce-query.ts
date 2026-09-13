// Workforce data lives in memory only, scoped to this tenant/user/company. No persisted/offline query storage.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCompanyId, getUser, isApiError, request } from './client.ts';

function identity(): string[] {
  const user = getUser();
  return [user?.tenantId ?? '', user?.id ?? '', getCompanyId() ?? ''];
}

export function useWorkforceRead<T>(action: string, input: Record<string, unknown>, enabled: boolean) {
  const scope = identity();
  return useQuery({
    queryKey: ['workforce', ...scope, action, input],
    queryFn: ({ signal }) =>
      request<T>('/actions/' + action, { method: 'POST', body: input, signal, cache: 'no-store' }),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: 'always',
    refetchInterval: 30_000,
    refetchOnWindowFocus: 'always',
  });
}

export function useWorkforceTask<T = unknown>() {
  const qc = useQueryClient();
  const scope = identity().join(':');
  return useMutation({
    mutationKey: ['workforce-task', scope],
    gcTime: 0,
    retry: false,
    networkMode: 'always',
    mutationFn: ({ action, input }: { action: string; input: Record<string, unknown> }) => {
      if (identity().join(':') !== scope) throw new Error('会社または利用者が変わりました。画面を開き直してください。');
      return request<T>('/actions/' + action, { method: 'POST', body: input, cache: 'no-store' });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['workforce'] });
    },
    onError: async (error) => {
      if (isApiError(error) && [401, 403, 404].includes(error.status)) {
        // Immediately hide successful data from an earlier authorization or removed target, then re-check active readers.
        await Promise.all([qc.resetQueries({ queryKey: ['workforce'] }), qc.invalidateQueries({ queryKey: ['meta'] })]);
      }
    },
  });
}
