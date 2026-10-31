// List query <-> URL search params. Pure; unit-tested in query.test.ts.

export const PAGE_SIZE = 50;

export interface ListState {
  search?: string;
  /** `field:asc` | `field:desc` (matches the API's orderBy syntax). */
  sort?: string;
  /** 1-based page. */
  page?: number;
  where?: Record<string, unknown>;
}

export interface SortSpec {
  field: string;
  dir: 'asc' | 'desc';
}

export function parseSort(sort: string | undefined): SortSpec | undefined {
  if (!sort) return undefined;
  const idx = sort.lastIndexOf(':');
  const field = idx === -1 ? sort : sort.slice(0, idx);
  const dir = idx === -1 ? 'asc' : sort.slice(idx + 1);
  if (!field) return undefined;
  return { field, dir: dir === 'desc' ? 'desc' : 'asc' };
}

export function formatSort(spec: SortSpec): string {
  return `${spec.field}:${spec.dir}`;
}

/** Next sort when a header is clicked: none -> asc -> desc -> none (a different field starts at asc). */
export function toggleSort(current: string | undefined, field: string): string | undefined {
  const cur = parseSort(current);
  if (!cur || cur.field !== field) return formatSort({ field, dir: 'asc' });
  if (cur.dir === 'asc') return formatSort({ field, dir: 'desc' });
  return undefined;
}

/** Builds `GET /api/:entity?...` parameters for the API (docs/specs/api-app.md AC-5). */
export function buildListQuery(state: ListState, pageSize = PAGE_SIZE): URLSearchParams {
  const p = new URLSearchParams();
  const search = state.search?.trim();
  if (search) p.set('search', search);
  const sort = parseSort(state.sort);
  if (sort) p.set('orderBy', formatSort(sort));
  if (state.where && Object.keys(state.where).length > 0) p.set('where', JSON.stringify(state.where));
  const page = Math.max(1, Math.floor(state.page ?? 1));
  p.set('limit', String(pageSize));
  p.set('offset', String((page - 1) * pageSize));
  return p;
}

/** URL search params of the list route (`?q=&sort=&page=`). Keys are absent, never undefined (exactOptionalPropertyTypes). */
export interface ListSearch {
  q?: string;
  sort?: string;
  page?: number;
  /** Applied filters as a JSON object (list-workbench AC-2); validated per entity by lib/list-filters.ts. */
  f?: Record<string, unknown>;
  /** Link contract of other screens (AC-3, the close guide): rewritten into `f` on the next filter change. */
  status?: string;
  from?: string;
  to?: string;
}

/** Longest filter value kept from the URL; the REST `where` parameter accepts 4,000 characters. */
export const MAX_FILTER_JSON = 3000;

function filterObject(raw: unknown): Record<string, unknown> | undefined {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const json = JSON.stringify(value);
  return json.length > 2 && json.length <= MAX_FILTER_JSON ? (value as Record<string, unknown>) : undefined;
}

/** Validates router search params (unknown keys dropped, bad values ignored). */
export function parseListSearch(raw: Record<string, unknown>): ListSearch {
  const out: ListSearch = {};
  if (typeof raw.q === 'string' && raw.q.length > 0) out.q = raw.q;
  if (typeof raw.sort === 'string' && parseSort(raw.sort)) out.sort = raw.sort;
  const page = typeof raw.page === 'number' ? raw.page : typeof raw.page === 'string' ? Number(raw.page) : NaN;
  if (Number.isInteger(page) && page > 1) out.page = page;
  const f = filterObject(raw.f);
  if (f) out.f = f;
  for (const key of ['status', 'from', 'to'] as const) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0 && value.length <= 100) out[key] = value;
  }
  return out;
}

export function toListState(s: ListSearch): ListState {
  const out: ListState = {};
  if (s.q !== undefined) out.search = s.q;
  if (s.sort !== undefined) out.sort = s.sort;
  if (s.page !== undefined) out.page = s.page;
  return out;
}

export interface SearchPatch {
  q?: string | undefined;
  sort?: string | undefined;
  page?: number | undefined;
  /** New applied filters; they replace the link parameters (`status` / `from` / `to`), which are dropped. */
  f?: Record<string, unknown> | undefined;
}

/**
 * Applies a patch to the URL search; empty/undefined values remove the key, and changing q, sort or the filters resets
 * the page.
 */
export function updateSearch(prev: ListSearch, patch: SearchPatch): ListSearch {
  const merged: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(patch)) merged[k] = v;
  if ('f' in patch) {
    merged.status = undefined;
    merged.from = undefined;
    merged.to = undefined;
  }
  if (('q' in patch || 'sort' in patch || 'f' in patch) && !('page' in patch)) merged.page = undefined;
  return parseListSearch(merged);
}

export function pageCount(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
