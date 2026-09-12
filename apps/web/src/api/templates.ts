import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './client.ts';
import type { Label } from './types.ts';

export interface PackItem {
  name: string; label: Label; version: string; depends: string[]; hasSample: boolean;
  applied: boolean; appliedAt: string | null; appliedVersion: string | null; sampledAt: string | null;
}
export interface CompanyItem { id: string; code: string; name: string; currency: string }
export const packsKey = ['packs'] as const;

export function usePacks() {
  return useQuery({ queryKey: packsKey, queryFn: () => request<{ items: PackItem[] }>('/actions/pack.list', { method: 'POST', body: {} }), retry: false });
}
export function useCompanies() {
  return useQuery({ queryKey: ['companies'], queryFn: () => request<{ items: CompanyItem[]; companyId: string | null }>('/auth/companies'), staleTime: 60_000, retry: false });
}
export function useApplyPack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; sample: boolean }) => request('/actions/pack.apply', { method: 'POST', body: input }),
    onSuccess: async () => { await qc.invalidateQueries(); },
  });
}
