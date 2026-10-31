// Reads of the depreciation-run screen (docs/specs/fixed-assets.md AC-32). Keys live under ['finance', identity] so
// that useFinanceCommand (run) invalidates them and a company or user switch never reuses another's result.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './client.ts';
import { financeIdentity } from './finance.ts';
import { PREVIEW_ACTION, type DepreciationPreview } from '../lib/depreciation.ts';

export function depreciationPreviewKey(periodId: string | undefined) {
  return ['finance', financeIdentity(), 'depreciation-preview', periodId ?? null] as const;
}

/** fixed_assets.preview_depreciation; without a period id the server picks the default period (AC-11). */
export function fetchDepreciationPreview(periodId: string | undefined, signal?: AbortSignal) {
  return request<DepreciationPreview>(`/actions/${PREVIEW_ACTION}`, {
    method: 'POST',
    body: periodId ? { periodId } : {},
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
}

/** Like the close guide: the defaulted answer is reused as the pinned period's initial data (no second count). */
export function useDepreciationPreview(periodId: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: depreciationPreviewKey(periodId),
    queryFn: ({ signal }) => fetchDepreciationPreview(periodId, signal),
    initialData: () => {
      if (!periodId) return undefined;
      const defaulted = queryClient.getQueryData<DepreciationPreview>(depreciationPreviewKey(undefined));
      return defaulted?.period.id === periodId ? defaulted : undefined;
    },
    initialDataUpdatedAt: () => queryClient.getQueryState(depreciationPreviewKey(undefined))?.dataUpdatedAt,
    enabled,
    retry: false,
    staleTime: 2_000,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
    networkMode: 'always',
  });
}
