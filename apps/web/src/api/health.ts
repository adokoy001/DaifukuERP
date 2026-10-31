// Setup health (docs/specs/setup-health.md AC-1, AC-9): GET /meta/health for the current company. Read on demand:
// the screen refetches with "Check again", never on a timer.
import { useQuery } from '@tanstack/react-query';
import type { HealthReport } from '../lib/health.ts';
import { request } from './client.ts';

export const healthKey = ['setup-health'] as const;

export function useHealth(enabled: boolean) {
  return useQuery({
    queryKey: healthKey,
    queryFn: () => request<HealthReport>('/meta/health'),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
