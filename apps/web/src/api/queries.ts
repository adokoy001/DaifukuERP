// TanStack Query hooks over the REST sugar (docs/specs/api-app.md AC-5). Query keys are namespaced per entity so a mutation invalidates only its own entity.
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fieldValue } from '../lib/ext.ts';
import { workforceEntityForUi } from '../lib/workforce-entity.ts';
import { buildListQuery, type ListState } from '../lib/query.ts';
import { isApiError, request } from './client.ts';
import type { AppMeta, AuditEntry, EntityMeta, FieldMeta, ListResponse, LoginResponse, RecordJson } from './types.ts';

/** Client errors (4xx) are final; only network/5xx failures are retried. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export const keys = {
  meta: ['meta'] as const,
  list: (entity: string, params?: string) => (params === undefined ? (['list', entity] as const) : (['list', entity, params] as const)),
  record: (entity: string, id: string) => ['record', entity, id] as const,
  audit: (entity: string, id: string) => ['audit', entity, id] as const,
};

export function login(email: string, password: string, tenantId?: string): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', { method: 'POST', body: { email, password, ...(tenantId ? { tenantId } : {}) }, anonymous: true });
}

export function useMeta(): UseQueryResult<AppMeta> {
  return useQuery({ queryKey: keys.meta, queryFn: () => request<AppMeta>('/meta'), staleTime: Number.POSITIVE_INFINITY, retry: false });
}

export function useEntityMeta(name: string): { meta: UseQueryResult<AppMeta>; entity: EntityMeta | undefined } {
  const meta = useMeta();
  const entity = useMemo(() => {
    const found = meta.data?.entities.find((e) => e.name === name);
    return found ? workforceEntityForUi(found) : undefined;
  }, [meta.data, name]);
  return { meta, entity };
}

export function useList(entity: string, state: ListState, enabled = true): UseQueryResult<ListResponse> {
  const params = buildListQuery(state).toString();
  return useQuery({
    queryKey: keys.list(entity, params),
    queryFn: ({ signal }) => request<ListResponse>(`/api/${entity}?${params}`, { signal, ...(entity.startsWith('workforce_') ? { cache: 'no-store' as const } : {}) }),
    ...(entity.startsWith('workforce_') ? { gcTime: 0, staleTime: 0 } : {}),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useRecord(entity: string, id: string | undefined): UseQueryResult<RecordJson> {
  return useQuery({ queryKey: keys.record(entity, id ?? ''), queryFn: ({ signal }) => request<RecordJson>(`/api/${entity}/${id ?? ''}`, { signal, ...(entity.startsWith('workforce_') ? { cache: 'no-store' as const } : {}) }), ...(entity.startsWith('workforce_') ? { gcTime: 0, staleTime: 0 } : {}), enabled: id !== undefined, retry: false });
}

function normalizeAudit(raw: unknown): AuditEntry[] {
  // Contract assumption: `GET /api/:entity/:id/audit` returns AuditEntry[]; `{ items }` / `{ entries }` wrappers are tolerated.
  if (Array.isArray(raw)) return raw as AuditEntry[];
  if (typeof raw === 'object' && raw !== null) {
    const rec = raw as Record<string, unknown>;
    const inner = rec.items ?? rec.entries;
    if (Array.isArray(inner)) return inner as AuditEntry[];
  }
  return [];
}

export function useAudit(entity: string, id: string | undefined): UseQueryResult<AuditEntry[]> {
  return useQuery({
    queryKey: keys.audit(entity, id ?? ''),
    queryFn: async () => normalizeAudit(await request<unknown>(`/api/${entity}/${id ?? ''}/audit`)),
    enabled: id !== undefined,
  });
}

/** Ref widget: search the target entity by its display field (server `search` uses views.search / displayField). */
export function useRefSearch(refEntity: string | undefined, search: string, enabled: boolean): UseQueryResult<ListResponse> {
  const params = buildListQuery({ search, page: 1 }, 20).toString();
  return useQuery({
    queryKey: keys.list(refEntity ?? '', `ref:${params}`),
    queryFn: () => request<ListResponse>(`/api/${refEntity ?? ''}?${params}`),
    enabled: enabled && refEntity !== undefined,
    placeholderData: keepPreviousData,
  });
}

/**
 * Resolves ref ids shown on a list page to display values: one `where: {id: {$in}}` query per ref column
 * (useQueries, because the number of ref columns depends on the entity).
 */
export function useRefLabelMaps(refFields: readonly FieldMeta[], rows: readonly RecordJson[]): (field: FieldMeta, id: string) => string | undefined {
  const specs = refFields.map((f) => {
    const ids = [
      ...new Set(
        rows.flatMap((r) => {
          const v = fieldValue(r, f);
          return typeof v === 'string' ? [v] : [];
        }),
      ),
    ].sort();
    const params = buildListQuery({ where: { id: { $in: ids } } }, 500).toString();
    return { field: f, ids, params };
  });
  const results = useQueries({
    queries: specs.map((s) => ({
      queryKey: keys.list(s.field.ref ?? '', `labels:${s.params}`),
      queryFn: () => request<ListResponse>(`/api/${s.field.ref ?? ''}?${s.params}`),
      enabled: s.field.ref !== undefined && s.ids.length > 0,
      staleTime: 60_000,
    })),
  });
  const maps = new Map<string, Map<string, string>>();
  specs.forEach((s, i) => {
    const m = new Map<string, string>();
    for (const row of results[i]?.data?.items ?? []) {
      const v = (s.field.refDisplayField ? row[s.field.refDisplayField] : undefined) ?? row.name ?? row.number ?? row.code;
      m.set(row.id, typeof v === 'string' && v ? v : row.id);
    }
    maps.set(s.field.name, m);
  });
  return (field, id) => maps.get(field.name)?.get(id);
}

interface MutationCtx {
  entity: string;
}

function useInvalidate(entity: string) {
  const qc = useQueryClient();
  return async (id?: string) => {
    await qc.invalidateQueries({ queryKey: keys.list(entity) });
    if (id) {
      await qc.invalidateQueries({ queryKey: keys.record(entity, id) });
      await qc.invalidateQueries({ queryKey: keys.audit(entity, id) });
    }
  };
}

export function useCreate({ entity }: MutationCtx): UseMutationResult<RecordJson, Error, Record<string, unknown>> {
  const invalidate = useInvalidate(entity);
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => request<RecordJson>(`/api/${entity}`, { method: 'POST', body }),
    onSuccess: (rec) => invalidate(rec.id),
  });
}

export interface UpdateInput {
  id: string;
  patch: Record<string, unknown>;
  expectedVersion: number;
}

/** AC-7: every update carries `expectedVersion`; a 409 CONFLICT surfaces as ApiError.code === 'CONFLICT'. */
export function useUpdate({ entity }: MutationCtx): UseMutationResult<RecordJson, Error, UpdateInput> {
  const invalidate = useInvalidate(entity);
  return useMutation({
    mutationFn: ({ id, patch, expectedVersion }: UpdateInput) => request<RecordJson>(`/api/${entity}/${id}`, { method: 'PATCH', body: { patch, expectedVersion } }),
    onSuccess: (rec) => invalidate(rec.id),
  });
}

export function useDelete({ entity }: MutationCtx): UseMutationResult<unknown, Error, { id: string; expectedVersion: number }> {
  const invalidate = useInvalidate(entity);
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: string; expectedVersion: number }) => request<unknown>(`/api/${entity}/${id}`, { method: 'DELETE', body: { expectedVersion } }),
    onSuccess: (_r, { id }) => invalidate(id),
  });
}

export type DocOp = 'submit' | 'cancel' | 'amend';

export function useDocAction({ entity }: MutationCtx): UseMutationResult<RecordJson, Error, { id: string; op: DocOp; expectedVersion?: number; correctionDate?: string }> {
  const invalidate = useInvalidate(entity);
  return useMutation({
    mutationFn: ({ id, op, expectedVersion, correctionDate }: { id: string; op: DocOp; expectedVersion?: number; correctionDate?: string }) => request<RecordJson>(`/api/${entity}/${id}/${op}`, { method: 'POST', body: { expectedVersion, correctionDate } }),
    onSuccess: async (rec, { id }) => {
      await invalidate(id);
      if (rec.id !== id) await invalidate(rec.id);
    },
  });
}
