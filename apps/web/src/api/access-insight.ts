// Access insight (docs/specs/access-insight.md AC-1, AC-8, AC-17): the permission matrix and the audit search. Read
// on demand and never retried automatically: a 403 is an answer (the screen explains it), not a transient error.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  auditApiQuery,
  type AuditOptions,
  type AuditPage,
  type AuditScope,
  type AuditSearchState,
} from '../lib/audit-search.ts';
import type { PermissionMatrix } from '../lib/permission-matrix.ts';
import { request } from './client.ts';

export function usePermissionMatrix(enabled: boolean) {
  return useQuery({
    queryKey: ['access-insight', 'permissions'],
    queryFn: () => request<PermissionMatrix>('/admin/permissions'),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

export function useAuditSearch(state: AuditSearchState | null) {
  const query = state ? auditApiQuery(state) : '';
  return useQuery({
    queryKey: ['access-insight', 'audit', query],
    queryFn: () => request<AuditPage>(`/admin/audit?${query}`),
    enabled: state !== null,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

export function useAuditOptions(scope: AuditScope, enabled: boolean) {
  return useQuery({
    queryKey: ['access-insight', 'audit-options', scope],
    queryFn: () => request<AuditOptions>(`/admin/audit/options?scope=${scope}`),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}
