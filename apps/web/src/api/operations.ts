import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './client.ts';
import type { ListResponse, TableResult } from './types.ts';
export interface OperationsFilters {
  from: string;
  to: string;
  asOf: string;
  storeId?: string;
}
export interface OperationsOverview {
  grossSales: string;
  netSales: string;
  tax: string;
  cashSales: string;
  cardSales: string;
  qrSales: string;
  consumptionCost: string;
  wasteCost: string;
  targetSales: string;
  achievementPct: string | null;
  cashDifference: string | null;
  expectedOpenDays: number;
  submittedDays: number;
  missingDays: number;
  reviewPendingDays: number;
  finalizePendingDays: number;
  zeroSalesDays: number;
  closedDays: number;
  unplannedDays: number;
  previousGrossSales: string;
  changeAmount: string;
  changePct: string | null;
}
export interface OperationsSnapshot {
  range: OperationsFilters & { previousFrom: string; previousTo: string; timeZone: string; workflowBasis: string };
  overview: OperationsOverview;
  series: TableResult;
  stores: TableResult;
  submissions: TableResult;
  sourceTable: TableResult;
}
export function useOperationsSnapshot(input: OperationsFilters, enabled: boolean) {
  return useQuery({
    queryKey: ['operations', input],
    queryFn: () =>
      request<OperationsSnapshot>('/actions/restaurant_chain.operations_snapshot', { method: 'POST', body: input }),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
export function useSettlementEvidence(input: OperationsFilters, enabled: boolean) {
  return useQuery({
    queryKey: ['operations-settlements', input],
    queryFn: () =>
      request<TableResult>('/actions/restaurant_chain.settlement_evidence', { method: 'POST', body: input }),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
export function useOperationsTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { action: string; input: Record<string, unknown> }) =>
      request('/actions/restaurant_chain.' + args.action, { method: 'POST', body: args.input }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['operations'] }),
        qc.invalidateQueries({ queryKey: ['operations-settlements'] }),
        qc.invalidateQueries({ queryKey: ['list'] }),
        qc.invalidateQueries({ queryKey: ['record'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
  });
}

export interface StoreOption {
  id: string;
  name: string;
}
async function storeOptions(): Promise<StoreOption[]> {
  const stores: StoreOption[] = [];
  for (let offset = 0; ;) {
    const page = await request<ListResponse>('/api/restaurant_chain_store?limit=500&offset=' + offset);
    if (page.total > 10_000) throw new Error('Too many stores to select. Narrow the company scope.');
    stores.push(...page.items.map((item) => ({ id: item.id, name: String(item.name) })));
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) return stores;
  }
}
export function useStoreOptions(enabled: boolean) {
  return useQuery({ queryKey: ['operations-stores'], queryFn: storeOptions, enabled, retry: false });
}
