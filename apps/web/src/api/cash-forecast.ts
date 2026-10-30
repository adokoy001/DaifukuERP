// Reads of /finance/cash-forecast (docs/specs/cash-forecast.md AC-20): the two report actions through the existing
// action path, keyed by user, tenant and company so another identity never reuses a result. `meta` and rows are
// checked with the banking contract schemas the server builds them from.
import {
  cashForecastMeta,
  cashForecastRow,
  cashScheduleMeta,
  cashScheduleRow,
  type CashForecastMeta,
  type CashForecastRow,
  type CashScheduleMeta,
  type CashScheduleRow,
} from '@daifuku/mod-banking/contract';
import { useQuery } from '@tanstack/react-query';
import { request } from './client.ts';
import { financeIdentity } from './finance.ts';
import type { TableResult } from './types.ts';
import { actionInput, CASH_FORECAST_ACTION, CASH_SCHEDULE_ACTION, type CashConditions } from '../lib/cash-forecast.ts';

export interface CashForecastResult {
  table: TableResult;
  meta: CashForecastMeta;
  rows: CashForecastRow[];
}

export interface CashScheduleResult {
  table: TableResult;
  meta: CashScheduleMeta;
  rows: CashScheduleRow[];
}

function read<T>(action: string, conditions: CashConditions, parse: (table: TableResult) => T, signal?: AbortSignal) {
  return request<TableResult>(`/actions/${action}`, {
    method: 'POST',
    body: actionInput(conditions),
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  }).then(parse);
}

const options = { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, networkMode: 'always' } as const;

export function useCashForecast(conditions: CashConditions | undefined) {
  return useQuery({
    queryKey: ['finance', financeIdentity(), CASH_FORECAST_ACTION, conditions ?? null],
    queryFn: ({ signal }) =>
      read(
        CASH_FORECAST_ACTION,
        conditions as CashConditions,
        (table): CashForecastResult => ({
          table,
          meta: cashForecastMeta.parse(table.meta),
          rows: table.rows.map((row) => cashForecastRow.parse(row)),
        }),
        signal,
      ),
    enabled: conditions !== undefined,
    ...options,
  });
}

export function useCashSchedule(conditions: CashConditions | undefined) {
  return useQuery({
    queryKey: ['finance', financeIdentity(), CASH_SCHEDULE_ACTION, conditions ?? null],
    queryFn: ({ signal }) =>
      read(
        CASH_SCHEDULE_ACTION,
        conditions as CashConditions,
        (table): CashScheduleResult => ({
          table,
          meta: cashScheduleMeta.parse(table.meta),
          rows: table.rows.map((row) => cashScheduleRow.parse(row)),
        }),
        signal,
      ),
    enabled: conditions !== undefined,
    ...options,
  });
}
