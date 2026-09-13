// Home dashboard counts (web-polish): one `GET /api/<entity>?limit=1&where={"docstatus":N}` per document entity per
// docstatus, in parallel; only `total` is read. Keys are the list keys, so a save/submit invalidates the counts too.
import { useQueries } from '@tanstack/react-query';
import { countQuery, DOCSTATUSES } from '../lib/dashboard.ts';
import { request } from './client.ts';
import { keys } from './queries.ts';
import type { Docstatus, EntityMeta, ListResponse } from './types.ts';

export interface CountCell {
  /** Undefined while loading or after an error. */
  total: number | undefined;
  error: boolean;
}

const PENDING: CountCell = { total: undefined, error: false };

export function useDocstatusCounts(entities: readonly EntityMeta[]): (entity: string, ds: Docstatus) => CountCell {
  const specs = entities.flatMap((e) => DOCSTATUSES.map((ds) => ({ entity: e.name, ds, params: countQuery(ds) })));
  const results = useQueries({
    queries: specs.map((s) => ({
      queryKey: keys.list(s.entity, s.params),
      queryFn: () => request<ListResponse>(`/api/${s.entity}?${s.params}`),
      staleTime: 30_000,
    })),
  });
  const cells = new Map<string, CountCell>();
  specs.forEach((s, i) => {
    const r = results[i];
    cells.set(
      `${s.entity}:${s.ds}`,
      r?.data ? { total: r.data.total, error: false } : { total: undefined, error: r?.isError === true },
    );
  });
  return (entity, ds) => cells.get(`${entity}:${ds}`) ?? PENDING;
}
