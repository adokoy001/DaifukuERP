// Reads for the evidence search screen (docs/specs/evidence-search.md AC-13, AC-16, AC-20). Keys live under
// ['finance', identity] so a company or user switch never shows another's result. Unlike the finance boards these reads
// never poll and never refetch on focus: each search runs a count and the link lookups, so they run only when the user
// searches (the page calls refetch for a repeated search) or changes page.
import { useQuery } from '@tanstack/react-query';
import { download, request } from './client.ts';
import { financeIdentity } from './finance.ts';
import {
  EVIDENCE_HISTORY_ACTION,
  EVIDENCE_SEARCH_ACTION,
  type EvidenceItem,
  type EvidenceResult,
  type HistoryResult,
} from '../lib/evidence-search.ts';

export function evidenceSearchKey(input: Record<string, unknown>) {
  return ['finance', financeIdentity(), 'evidence', input] as const;
}

export function evidenceHistoryKey(id: string) {
  return ['finance', financeIdentity(), 'evidence-history', id] as const;
}

const READ_OPTIONS = {
  retry: false,
  staleTime: 0,
  gcTime: 0,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  networkMode: 'always',
} as const;

export function useEvidenceSearch(input: Record<string, unknown>) {
  return useQuery({
    queryKey: evidenceSearchKey(input),
    queryFn: ({ signal }) =>
      request<EvidenceResult>(`/actions/${EVIDENCE_SEARCH_ACTION}`, {
        method: 'POST',
        body: input,
        signal,
        cache: 'no-store',
      }),
    ...READ_OPTIONS,
  });
}

export function useEvidenceHistory(id: string) {
  return useQuery({
    queryKey: evidenceHistoryKey(id),
    queryFn: ({ signal }) =>
      request<HistoryResult>(`/actions/${EVIDENCE_HISTORY_ACTION}`, {
        method: 'POST',
        body: { id },
        signal,
        cache: 'no-store',
      }),
    ...READ_OPTIONS,
  });
}

/** One file through the existing authorized download route (permission, storage scope, size and SHA-256 checks). */
export async function fetchEvidenceFile(item: Pick<EvidenceItem, 'id'>, signal?: AbortSignal): Promise<Blob> {
  return (await download(`/api/attachments/${item.id}/download`, signal)).blob;
}
