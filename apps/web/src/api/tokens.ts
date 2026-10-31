// API keys (docs/specs/machine-credentials.md "HTTP 契約"): GET/POST /admin/tokens, revoke and history. The API
// checks the tenant administrator and the step-up on every call. The issue result holds the secret: the mutation keeps
// no cache entry (gcTime 0) and the page resets it when the secret panel closes (AC-29); the list never contains it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MachineAuditEntry,
  MachineCredential,
  MachineCredentialList,
  MachinePurpose,
} from '../lib/machine-credentials.ts';
import { accessKey } from './access.ts';
import { request } from './client.ts';

export const machineCredentialsKey = ['admin-tokens'] as const;

export interface IssueInput {
  name: string;
  purpose: MachinePurpose;
  companyId: string;
  roles: string[];
  expiresInDays: number;
  stepUpToken: string;
}
export interface Issued {
  token: string;
  credential: MachineCredential;
}

export function useMachineCredentials(enabled: boolean) {
  return useQuery({
    queryKey: machineCredentialsKey,
    queryFn: ({ signal }) => request<MachineCredentialList>('/admin/tokens', { signal, cache: 'no-store' }),
    enabled,
    retry: false,
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: machineCredentialsKey }),
      // /admin/users shows each issuer's live keys (AC-33)
      qc.invalidateQueries({ queryKey: accessKey }),
    ]);
}

export function useIssueMachineCredential() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: IssueInput) =>
      request<Issued>('/admin/tokens', { method: 'POST', body: input, cache: 'no-store' }),
    gcTime: 0,
    // Refresh the list, never write the result (it holds the secret) into the list cache.
    onSuccess: () => void refresh(),
  });
}

export function useRevokeMachineCredential() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: { id: string; reason?: string }) =>
      request<{ credential: MachineCredential }>(`/admin/tokens/${encodeURIComponent(input.id)}/revoke`, {
        method: 'POST',
        body: input.reason ? { reason: input.reason } : {},
      }),
    onSuccess: () => void refresh(),
  });
}

export function useMachineCredentialAudit(id: string | null) {
  return useQuery({
    queryKey: [...machineCredentialsKey, 'audit', id],
    queryFn: ({ signal }) =>
      request<{ items: MachineAuditEntry[] }>(`/admin/tokens/${encodeURIComponent(id ?? '')}/audit`, {
        signal,
        cache: 'no-store',
      }),
    enabled: id !== null,
    gcTime: 0,
    retry: false,
  });
}
