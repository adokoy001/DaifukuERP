// document-links: GET /api/:entity/:id/related (AC-2/AC-4) and the fresh re-read used before 複製 / quick actions (AC-7).
// Types copied by hand from kernel/src/related.ts (the web bundle must not import @daifuku/kernel).
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { request } from './client.ts';
import { keys } from './queries.ts';
import type { Label, RecordJson } from './types.ts';

export type RelatedRelation = 'references' | 'referenced_by' | 'amended_from' | 'amendment';

export interface RelatedItem {
  id: string;
  title: string | null;
  number: string | null;
  docstatus: number | null;
  date: string | null;
  relation: RelatedRelation;
  /** Linking field: `journalEntryId`, `amendedFrom` or `<line entity>.<field>`. */
  via: string;
}

export interface RelatedGroup {
  entity: string;
  label: Label;
  kind: 'entity' | 'document';
  items: RelatedItem[];
  /** More than 50 matched; only the first 50 are listed. */
  more: boolean;
}

export interface RelatedResult {
  entity: string;
  id: string;
  groups: RelatedGroup[];
}

/** Under the record's key, so invalidating the record (save, submit, cancel) also refreshes its related records. */
export const relatedKey = (entity: string, id: string) => [...keys.record(entity, id), 'related'] as const;

export function useRelated(entity: string, id: string): UseQueryResult<RelatedResult> {
  return useQuery({
    queryKey: relatedKey(entity, id),
    queryFn: ({ signal }) => request<RelatedResult>(`/api/${entity}/${id}/related`, { signal }),
    retry: false,
  });
}

/** AC-7: the record as the server has it now (no cache), read just before its values seed a new record. */
export function fetchFreshRecord(entity: string, id: string): Promise<RecordJson> {
  return request<RecordJson>(`/api/${entity}/${id}`, { cache: 'no-store' });
}
