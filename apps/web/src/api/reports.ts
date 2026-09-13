// Report actions (web-phase1 AC-3): `POST /actions/<name>` with the generated input, result is a TableResult.
import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { request } from './client.ts';
import type { ActionMeta, AppMeta, TableResult } from './types.ts';

export function reportActions(meta: AppMeta | undefined): ActionMeta[] {
  return (meta?.actions ?? []).filter((a) => a.resultKind === 'table');
}

export function useRunReport(name: string): UseMutationResult<TableResult, Error, Record<string, unknown>> {
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      request<TableResult>(`/actions/${name}`, { method: 'POST', body: input }),
  });
}

/**
 * A table action read as a query (web-phase15 AC-1: the allocation picker's `payment.outstanding`). Not cached across
 * mounts (gcTime 0), so reopening the panel reads fresh balances; disabled until the input is complete.
 */
export function useActionTable(name: string, input: Record<string, unknown> | undefined): UseQueryResult<TableResult> {
  return useQuery({
    queryKey: ['action', name, input ?? null],
    queryFn: () => request<TableResult>(`/actions/${name}`, { method: 'POST', body: input ?? {} }),
    enabled: input !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
