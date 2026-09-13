// Browser copy of apps/api/src/analytics wire contract. No server imports in the browser bundle.
import { useQuery } from '@tanstack/react-query';
import { getCompanyId, getUser, request } from './client.ts';
import type { Label, TableColumn } from './types.ts';

export interface AnalyticsDataset {
  id: string;
  title: Label;
  description: Label;
  grain: Label;
  dateField: string;
  dimensions: TableColumn[];
  measures: TableColumn[];
  defaultRows: string[];
  defaultColumns: string[];
  defaultMeasure: string;
  defaultState: string;
  states: { value: string; label: Label }[];
}
export interface AnalyticsCatalog {
  datasets: AnalyticsDataset[];
  scopeKey: string;
}
export interface AnalyticsInput {
  dataset: string;
  from: string;
  to: string;
  state: string;
}
export interface AnalyticsSnapshot {
  scopeKey: string;
  dataset: string;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  meta: {
    from: string;
    to: string;
    state: string;
    rowCount: number;
    limit: number;
    complete: true;
    retrievedAt: string;
  };
}
export function useAnalyticsCatalog() {
  const user = getUser();
  return useQuery({
    queryKey: ['analytics-catalog', user?.tenantId, user?.id, getCompanyId()],
    queryFn: ({ signal }) => request<AnalyticsCatalog>('/analytics/catalog', { signal, cache: 'no-store' }),
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchInterval: 30_000,
    refetchOnWindowFocus: 'always',
  });
}
export function fetchAnalytics(input: AnalyticsInput, signal: AbortSignal) {
  return request<AnalyticsSnapshot>('/analytics/snapshot', { method: 'POST', body: input, signal, cache: 'no-store' });
}
