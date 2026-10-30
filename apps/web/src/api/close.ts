// Reads for the month-end close guide (docs/specs/close-guide.md). Keys live under ['finance', identity] so that
// useFinanceCommand (close / reopen) invalidates them, and a company or user switch never reuses another's result.
import { useQuery } from '@tanstack/react-query';
import { request } from './client.ts';
import { financeIdentity } from './finance.ts';
import type { ListResponse } from './types.ts';
import { CLOSE_READINESS_ACTION, type CloseReadiness, type ClosePeriod } from '../lib/close-guide.ts';

export function closeReadinessKey(periodId: string | undefined) {
  return ['finance', financeIdentity(), 'close-readiness', periodId ?? null] as const;
}

/** accounting.close_readiness; without a period id the server picks the default period (AC-8). */
export function fetchCloseReadiness(periodId: string | undefined, signal?: AbortSignal): Promise<CloseReadiness> {
  return request<CloseReadiness>(`/actions/${CLOSE_READINESS_ACTION}`, {
    method: 'POST',
    body: periodId ? { periodId } : {},
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
}

export function useCloseReadiness(periodId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: closeReadinessKey(periodId),
    queryFn: ({ signal }) => fetchCloseReadiness(periodId, signal),
    enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
    networkMode: 'always',
  });
}

/** Every fiscal period of the company, newest first, for the period picker (12 a year; 500 is about 40 years). */
export function useClosePeriods(enabled: boolean) {
  const params = new URLSearchParams({ orderBy: 'startDate:desc', limit: '500' });
  return useQuery({
    queryKey: ['finance', financeIdentity(), 'close-periods'],
    queryFn: async ({ signal }) =>
      (await request<ListResponse>(`/api/fiscal_period?${params}`, { signal, cache: 'no-store' })).items.map(
        (row): ClosePeriod => ({
          id: String(row.id),
          code: String(row.code),
          startDate: String(row.startDate),
          endDate: String(row.endDate),
          isClosed: row.isClosed === true,
        }),
      ),
    enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    networkMode: 'always',
  });
}
