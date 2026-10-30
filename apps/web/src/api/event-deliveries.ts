// Event delivery administration (docs/specs/event-delivery.md AC-14, AC-19, AC-20, AC-25): GET /admin/event-deliveries
// (one status, newest first, paged by cursor), POST .../retry, GET /admin/webhooks and POST .../secret. The issued
// secret lives only in the caller's component state; nothing here caches or stores it.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeliveryItem, DeliveryList, DeliveryTab, IssuedSecret, WebhooksView } from '../lib/event-deliveries.ts';
import { request } from './client.ts';

export const deliveriesKey = ['event-deliveries'] as const;
export const webhooksKey = ['admin-webhooks'] as const;

export function useDeliveries(status: DeliveryTab, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...deliveriesKey, status],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ status, limit: '50' });
      if (pageParam) search.set('before', pageParam);
      return request<DeliveryList>(`/admin/event-deliveries?${search.toString()}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useWebhooks(enabled: boolean) {
  return useQuery({
    queryKey: webhooksKey,
    queryFn: () => request<WebhooksView>('/admin/webhooks'),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useRetryDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<DeliveryItem>(`/admin/event-deliveries/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: deliveriesKey }),
  });
}

export function useIssueSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (endpointId: string) =>
      request<IssuedSecret>(`/admin/webhooks/${encodeURIComponent(endpointId)}/secret`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: webhooksKey }),
  });
}
