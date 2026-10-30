// Calls of the opening balances screen (docs/specs/opening-balances.md AC-31..AC-37): the status, the four imports, the
// reversal of the opening journal, and the counts of opening documents through the generic list API (`total`).
import { useQuery } from '@tanstack/react-query';
import { request } from './client.ts';
import { financeIdentity } from './finance.ts';
import type { ListResponse } from './types.ts';
import {
  OPENING_REVERSE_ACTION,
  OPENING_STATUS_ACTION,
  SECTION_ACTION,
  type OpeningBalanceStatus,
  type OpeningImportResult,
  type OpeningSection,
} from '../lib/opening-balances.ts';

export function openingStatusKey(fiscalYearId: string | undefined) {
  return ['finance', financeIdentity(), 'opening-status', fiscalYearId ?? null] as const;
}

export function useOpeningStatus(fiscalYearId: string | undefined) {
  return useQuery({
    queryKey: openingStatusKey(fiscalYearId),
    queryFn: ({ signal }) =>
      request<OpeningBalanceStatus>(`/actions/${OPENING_STATUS_ACTION}`, {
        method: 'POST',
        body: fiscalYearId ? { fiscalYearId } : {},
        cache: 'no-store',
        signal,
      }),
    retry: false,
    gcTime: 0,
    networkMode: 'always',
  });
}

export function runOpeningImport(
  section: OpeningSection,
  body: { fiscalYearId: string; mode: 'dry-run' | 'execute'; rows: Record<string, string | null>[] },
): Promise<OpeningImportResult> {
  return request<OpeningImportResult>(`/actions/${SECTION_ACTION[section]}`, {
    method: 'POST',
    body,
    cache: 'no-store',
  });
}

export function reverseOpeningJournal(fiscalYearId: string): Promise<unknown> {
  return request<unknown>(`/actions/${OPENING_REVERSE_ACTION}`, {
    method: 'POST',
    body: { fiscalYearId },
    cache: 'no-store',
  });
}

/** AC-32: submitted opening documents of an entity dated the opening date (`total` of the generic list API). */
export function useOpeningCount(entity: string, where: Record<string, unknown>, enabled: boolean) {
  const params = new URLSearchParams({ where: JSON.stringify(where), limit: '1' });
  return useQuery({
    queryKey: ['finance', financeIdentity(), 'opening-count', entity, where],
    queryFn: ({ signal }) =>
      request<ListResponse>(`/api/${entity}?${params.toString()}`, { signal, cache: 'no-store' }),
    enabled,
    retry: false,
    gcTime: 0,
    networkMode: 'always',
  });
}
