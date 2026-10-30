// document-links: GET /api/:entity/:id/related (AC-2/AC-4) and the fresh re-read used before 複製 / quick actions (AC-7).
// Types copied by hand from kernel/src/related.ts (the web bundle must not import @daifuku/kernel).
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { request } from './client.ts';
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

/**
 * Its own key root, not under the record's key: saves, submits and cancels await the record's invalidation, and must
 * not wait for this slower read (the form never waits for the panel). The record's version is part of the key, so a
 * saved or submitted record re-reads its related records in the background.
 */
const relatedKey = (entity: string, id: string, version: number) => ['related', entity, id, version] as const;

/** The related records of one record version; while a newer version loads, the same record's last result stays shown. */
export function useRelated(entity: string, id: string, version: number): UseQueryResult<RelatedResult> {
  return useQuery({
    queryKey: relatedKey(entity, id, version),
    queryFn: ({ signal }) => request<RelatedResult>(`/api/${entity}/${id}/related`, { signal }),
    retry: false,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === entity && previousQuery.queryKey[2] === id ? previous : undefined,
  });
}

/** AC-7: the record as the server has it now (no cache), read just before its values seed a new record. */
export function fetchFreshRecord(entity: string, id: string): Promise<RecordJson> {
  return request<RecordJson>(`/api/${entity}/${id}`, { cache: 'no-store' });
}
