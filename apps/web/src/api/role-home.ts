// Role-based home reads (docs/specs/role-home.md AC-4..AC-6, AC-15). Every card calls an existing action, REST read
// or analytics snapshot with the user's own session; keys carry tenant, user and company, nothing is kept between
// mounts, and reads happen only when a view is shown or on the manual refresh/retry (like the inbox, AC-7 there).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { browserStorage } from '../lib/assist-storage.ts';
import {
  homeLayoutKey,
  readHomeLayout,
  resolveHomeLayout,
  writeHomeLayout,
  type HomeLayout,
} from '../lib/role-home.ts';
import { getCompanyId, getUser, request } from './client.ts';

/** AC-15: no polling, no refetch on focus, visibility or reconnect, no automatic retry, nothing cached for later. */
export const HOME_READ_OPTIONS = {
  staleTime: 0,
  gcTime: 0,
  retry: false,
  refetchInterval: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

/** AC-15: a view chosen in the switcher starts reading once the choice has held this long (arrow keys pass over). */
export const SWITCH_SETTLE_MS = 300;

/** AC-6: tenant, user and company of this tab; a company switch reloads the page, so this is per render. */
export function homeIdentity(): string {
  const user = getUser();
  return `${user?.tenantId ?? ''}:${user?.id ?? ''}:${getCompanyId() ?? ''}`;
}

/** Root of every card query key; the home "Refresh" re-reads the active queries under it. */
export const homeQueryRoot = () => ['role-home', homeIdentity()] as const;

/** POST /actions/<name> with the caller's session; `signal` aborts the read when its view is left (AC-15). */
export function callHomeAction<T>(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  return request<T>('/actions/' + name, {
    method: 'POST',
    body: input,
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
}

/** GET /api/<entity> list with the caller's session (AC-7: only entities /meta lets the caller read). */
export function listHomeEntity<T>(entity: string, params: URLSearchParams, signal?: AbortSignal): Promise<T> {
  return request<T>(`/api/${entity}?${params.toString()}`, { cache: 'no-store', ...(signal ? { signal } : {}) });
}

/** One card read. `parts` names the source and its input; the identity is added here (AC-6). */
export function useHomeRead<T>(parts: readonly unknown[], load: (signal: AbortSignal) => Promise<T>, enabled: boolean) {
  return useQuery({
    queryKey: [...homeQueryRoot(), ...parts],
    queryFn: ({ signal }) => load(signal),
    enabled,
    ...HOME_READ_OPTIONS,
  });
}

/** AC-15: re-read every active card query of this home (the previous values stay on screen meanwhile). */
export function useHomeRefresh() {
  const qc = useQueryClient();
  return useCallback(() => qc.refetchQueries({ queryKey: homeQueryRoot(), type: 'active' }), [qc]);
}

/**
 * AC-2..AC-5: the view to show and the switcher's select. The stored choice is read once per tenant/user/company key;
 * a choice is written only when the user picks a tab, and when the storage refuses, the choice lasts for this page only.
 */
export function useHomeLayout(available: readonly HomeLayout[]) {
  const user = getUser();
  const key = homeLayoutKey({
    tenantId: user?.tenantId ?? '',
    userId: user?.id ?? '',
    companyId: getCompanyId() ?? '',
  });
  const stored = useMemo(() => readHomeLayout(browserStorage(), key), [key]);
  const [chosen, setChosen] = useState<{ key: string | undefined; layout: HomeLayout }>();
  const picked = chosen && chosen.key === key && available.includes(chosen.layout) ? chosen.layout : undefined;
  const layout = picked ?? resolveHomeLayout(available, stored);
  const select = useCallback(
    (next: HomeLayout) => {
      setChosen({ key, layout: next });
      writeHomeLayout(browserStorage(), key, next);
    },
    [key],
  );
  return { layout, select };
}
