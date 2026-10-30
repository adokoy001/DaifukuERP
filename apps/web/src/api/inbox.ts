// To-do inbox reads (docs/specs/inbox.md AC-4..AC-7): every runnable `<module>.todo` provider from /meta is called in
// parallel with Promise.allSettled, so one failing provider never hides the others. Reads happen when a screen that
// shows the inbox is mounted and on the manual refresh/retry only: no polling, no refetch on focus or reconnect.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  inboxGroups,
  inboxProviders,
  inboxSummary,
  replaceOutcome,
  type InboxProvider,
  type ProviderOutcome,
} from '../lib/inbox.ts';
import { getCompanyId, getUser, request } from './client.ts';
import { useNavigation } from './navigation.ts';

export type TodoCall = (action: string, signal?: AbortSignal) => Promise<unknown>;

export const callTodo: TodoCall = (action, signal) =>
  request<unknown>('/actions/' + action, {
    method: 'POST',
    body: {},
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });

/** One outcome per provider, in provider order; a rejected call becomes `{ ok: false }` for that provider only. */
export async function loadInbox(
  providers: readonly InboxProvider[],
  call: TodoCall = callTodo,
  signal?: AbortSignal,
): Promise<ProviderOutcome[]> {
  const settled = await Promise.allSettled(providers.map((provider) => call(provider.action, signal)));
  return settled.map((result, index) => {
    const action = providers[index]?.action ?? '';
    return result.status === 'fulfilled'
      ? { action, ok: true, value: result.value }
      : { action, ok: false, error: result.reason as unknown };
  });
}

/**
 * AC-7: read when a screen showing the inbox mounts and on the manual refresh/retry only. No polling, no refetch on
 * focus or reconnect, no automatic retry, and nothing kept for the next mount.
 */
export const INBOX_QUERY_OPTIONS = {
  staleTime: 0,
  gcTime: 0,
  retry: false,
  refetchInterval: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

function inboxIdentity(): string {
  const user = getUser();
  return `${user?.tenantId ?? ''}:${user?.id ?? ''}:${getCompanyId() ?? ''}`;
}

export function useInbox() {
  const { catalog, meta } = useNavigation();
  const providers = useMemo(() => inboxProviders(meta.data), [meta.data]);
  const qc = useQueryClient();
  const key = useMemo(
    () => ['inbox', inboxIdentity(), providers.map((provider) => provider.action).join(',')] as const,
    [providers],
  );
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => loadInbox(providers, callTodo, signal),
    enabled: providers.length > 0,
    ...INBOX_QUERY_OPTIONS,
  });
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  /** Reloads one provider; resolves to whether it loaded, or undefined when a retry of it was already running. */
  const retry = useCallback(
    async (action: string): Promise<boolean | undefined> => {
      if (inFlight.current.has(action)) return undefined;
      inFlight.current.add(action);
      setRetrying((current) => new Set(current).add(action));
      let outcome: ProviderOutcome;
      try {
        outcome = { action, ok: true, value: await callTodo(action) };
      } catch (error) {
        outcome = { action, ok: false, error };
      }
      qc.setQueryData<ProviderOutcome[]>(key, (current) => replaceOutcome(current, outcome));
      inFlight.current.delete(action);
      setRetrying((current) => {
        const next = new Set(current);
        next.delete(action);
        return next;
      });
      return outcome.ok;
    },
    [qc, key],
  );
  // A manual refresh keeps the previous counts on screen (docs/conventions/ui.md 状態表示); a retried failure stays a
  // failure (its button keeps focus) until the retry settles, and only providers without any result show loading.
  const groups = inboxGroups(providers, query.data, retrying, catalog);
  return {
    meta,
    providers,
    groups,
    summary: inboxSummary(groups),
    refreshing: query.isFetching,
    refresh: () => void query.refetch(),
    retry,
  };
}
