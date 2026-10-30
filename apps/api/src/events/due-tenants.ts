// Tenants with due delivery work (docs/specs/event-delivery.md AC-2 (1), AC-23; ADR-0037). The only cross-tenant read of
// the worker: a fixed owner-connection query that returns tenant ids and nothing else, served by the partial indexes
// outbox_due_idx, event_deliveries_due_idx and inbox_watches_due_idx. Everything else runs per tenant on the app
// connection (RLS).
import type { Database } from '@daifuku/kernel';

export type DueTenantsReader = (now: Date) => Promise<string[]>;

export function dueTenantsReader(owner: Database): DueTenantsReader {
  return async (now) => {
    const at = now.toISOString();
    const rows = await owner.sql<{ tenant_id: string }[]>`
      select distinct tenant_id from outbox
        where published_at is null and dead_at is null and (next_attempt_at is null or next_attempt_at <= ${at})
      union
      select distinct tenant_id from event_deliveries
        where status in ('pending', 'sending') and next_attempt_at <= ${at}
      union
      select distinct tenant_id from inbox_watches where next_check_at <= ${at}
      order by tenant_id`;
    return rows.map((row) => row.tenant_id);
  };
}
