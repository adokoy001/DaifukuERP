// Setup wizard (docs/specs/setup-wizard.md AC-1, AC-5, AC-7): GET /meta/setup-status for the current company. Read on
// demand — when /setup or the home card mounts, after each save, and on "Check again"; never on a timer or on focus.
// Only sessions whose /meta roles include admin ask for it (AC-7), so other homes never produce a 403.
import { useQuery } from '@tanstack/react-query';
import type { SetupStatus } from '../lib/setup-wizard.ts';
import { request } from './client.ts';

export const setupStatusKey = ['setup-status'] as const;

export function useSetupStatus(enabled: boolean) {
  return useQuery({
    queryKey: setupStatusKey,
    queryFn: ({ signal }) => request<SetupStatus>('/meta/setup-status', { signal }),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
