// Reads and the run of the recurring journal screen (docs/specs/recurring-journals.md AC-23). The schedule key lives
// under ['finance', identity] so the generation (useFinanceCommand) invalidates it, and a company or user switch never
// reuses another's result.
import { useQuery } from '@tanstack/react-query';
import { request } from './client.ts';
import { financeIdentity, useFinanceCommand } from './finance.ts';
import type { TableResult } from './types.ts';
import {
  GENERATE_RECURRING_ACTION,
  parseSchedule,
  RECURRING_SCHEDULE_ACTION,
  type GenerateResult,
  type Schedule,
} from '../lib/recurring.ts';

export function recurringScheduleKey(asOf: string) {
  return ['finance', financeIdentity(), 'recurring-schedule', asOf] as const;
}

export function useRecurringSchedule(asOf: string, enabled: boolean) {
  return useQuery({
    queryKey: recurringScheduleKey(asOf),
    queryFn: async ({ signal }): Promise<Schedule> =>
      parseSchedule(
        await request<TableResult>(`/actions/${RECURRING_SCHEDULE_ACTION}`, {
          method: 'POST',
          body: { asOf },
          cache: 'no-store',
          signal,
        }),
      ),
    enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    networkMode: 'always',
  });
}

/** accounting.generate_recurring for one asOf; success invalidates the schedule, lists and records. */
export function useGenerateRecurring() {
  const command = useFinanceCommand<GenerateResult>();
  return {
    ...command,
    generate: (asOf: string, handlers: Parameters<typeof command.mutate>[1]) =>
      command.mutate({ action: GENERATE_RECURRING_ACTION, input: { asOf } }, handlers),
  };
}
