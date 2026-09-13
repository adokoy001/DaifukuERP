import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCompanyId, getUser, isApiError, request } from './client.ts';
import type { AppMeta } from './types.ts';
import { edgeBoardOutput, type EdgeBoard } from '@daifuku/mod-edge-integration/contract';
export type EdgeRow = { id: string; version?: number; [key: string]: unknown };
export const edgeIdentity = () => `${getUser()?.tenantId ?? ''}:${getUser()?.id ?? ''}:${getCompanyId() ?? ''}`;
export function useEdgeAccess() {
  return useQuery({
    queryKey: ['edge-access', edgeIdentity()],
    queryFn: ({ signal }) => request<AppMeta>('/meta', { signal, cache: 'no-store' }),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: 'always',
    networkMode: 'always',
  });
}
export function useEdgeBoard(enabled: boolean, gatewayId?: string) {
  return useQuery({
    queryKey: ['edge', edgeIdentity(), gatewayId],
    queryFn: ({ signal }) =>
      request<EdgeBoard>('/actions/edge.board', {
        method: 'POST',
        body: gatewayId ? { gatewayId } : {},
        signal,
        cache: 'no-store',
      }).then((value) => edgeBoardOutput.parse(value)),
    enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: 'always',
    networkMode: 'always',
  });
}
export function useEdgeCommand() {
  const qc = useQueryClient(),
    identity = edgeIdentity();
  return useMutation({
    mutationKey: ['edge-command', identity],
    gcTime: 0,
    retry: false,
    networkMode: 'always',
    mutationFn: ({ action, input, path }: { action?: string; path?: string; input: unknown }) => {
      if (edgeIdentity() !== identity) throw new Error('会社または利用者が変わりました。開き直してください。');
      return request<Record<string, unknown>>(path ?? '/actions/' + action, {
        method: 'POST',
        body: input,
        cache: 'no-store',
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['edge'] });
    },
    onError: async (error) => {
      if (isApiError(error) && [401, 403, 404].includes(error.status))
        await Promise.all([
          qc.resetQueries({ queryKey: ['edge'] }),
          qc.invalidateQueries({ queryKey: ['meta'] }),
          qc.resetQueries({ queryKey: ['edge-access'] }),
        ]);
    },
  });
}
