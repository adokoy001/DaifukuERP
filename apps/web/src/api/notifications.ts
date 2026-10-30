// The caller's own inbox mail switch (docs/specs/event-delivery.md AC-18, AC-26): GET / PUT /me/notifications.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InboxNotification } from '../lib/event-deliveries.ts';
import { request } from './client.ts';

export const notificationKey = ['me-notifications'] as const;

export function useInboxNotification() {
  return useQuery({
    queryKey: notificationKey,
    queryFn: () => request<InboxNotification>('/me/notifications'),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useSetInboxNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inboxEmail: boolean) =>
      request<InboxNotification>('/me/notifications', { method: 'PUT', body: { inboxEmail } }),
    onSuccess: (value) => qc.setQueryData(notificationKey, value),
  });
}
