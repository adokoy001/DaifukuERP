import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError, request } from './client.ts';

export interface AccessUser { id: string; email: string; name: string; active: boolean; tenantAdmin: boolean; defaultCompanyId: string | null; version: number }
export interface Membership { userId: string; companyId: string; roles: string[]; accessScope: 'all' | 'stores' | 'sites'; storeIds: string[]; siteIds: string[]; version: number }
export interface AccessCatalog { users: AccessUser[]; companies: { id: string; code: string; name: string; currency: string }[]; memberships: Membership[]; roles: string[]; stores: { id: string; companyId: string; name: string }[]; sites: { id: string; companyId: string; name: string }[] }
export interface AccessAuditEntry { id: string; entity: string; op: string; actorType: string; actorId: string; onBehalfOf: string | null; at: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }
export interface AccessEditorStatus { dirty: boolean; busy: boolean }
export const accessKey = ['access-admin'] as const;
export function useAccessCatalog(enabled: boolean) { return useQuery({ queryKey: accessKey, queryFn: () => request<AccessCatalog>('/admin/access'), enabled, refetchOnWindowFocus: 'always', retry: false }); }
export function useAccessAudit(userId: string) { return useQuery({ queryKey: [...accessKey, 'audit', userId], queryFn: () => request<{ items: AccessAuditEntry[] }>('/admin/access/audit?userId=' + encodeURIComponent(userId)), enabled: Boolean(userId), retry: false }); }
export function useAccessMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body: unknown }) => request(input.path, { method: input.method, body: input.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: accessKey }),
    onError: (error) => {
      // Refresh the comparison data after a conflict; editors keep their draft and baseline version.
      if (isApiError(error) && error.code === 'CONFLICT') return qc.invalidateQueries({ queryKey: accessKey });
      return undefined;
    },
  });
}
