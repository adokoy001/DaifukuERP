// form-ergonomics AC-9: "previous / next" on a record opened from the generic list. The list hands the ids it shows,
// its criteria (`ListSearch`) and the total to the record page through router history state, bound to the session that
// made it (tenant, user, company — like the draft seeds of lib/duplicate.ts), so Back after a sign-in as someone else
// or a company switch shows no list position. At the first / last row of the page the neighbour comes from the
// previous / next page of the same criteria. Pure; the React side is components/record-nav.tsx.
import type { EntityMeta } from '../api/types.ts';
import { effectiveFilters, filterDefs, filtersToDomain } from './list-filters.ts';
import { PAGE_SIZE, parseListSearch, toListState, type ListSearch, type ListState } from './query.ts';

export const RECORD_NAV_STATE_KEY = 'recordNav';
const MAX_IDS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecordNav {
  entity: string;
  /** Ids of the list page, in the order shown. */
  ids: string[];
  /** The list's criteria: search, sort, page and filters, as in its URL. */
  search: ListSearch;
  /** Rows matching the criteria (all pages). */
  total: number;
}

export interface RecordPosition {
  /** 1-based position among all matching rows. */
  ordinal: number;
  total: number;
  prev?: string;
  next?: string;
  /** The previous / next record is on the neighbouring page (fetched when the button is pressed). */
  prevPage: boolean;
  nextPage: boolean;
}

/** The list's REST query for `search`: the same `where` the list sends (lib/list-filters.ts) plus search, sort, page. */
export function listStateOf(entity: EntityMeta, search: ListSearch): ListState {
  const defs = filterDefs(entity);
  const where = filtersToDomain(effectiveFilters(search, entity, defs), defs);
  return { ...toListState(search), ...(where ? { where } : {}) };
}

/** Router history state carrying the list position, bound to the session `owner` (spread over the current state). */
export function recordNavState(nav: RecordNav, owner: string): Record<string, unknown> {
  return { [RECORD_NAV_STATE_KEY]: { ...nav, ids: nav.ids.slice(0, MAX_IDS), owner } };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The list position in history state when it is for `entity` and was made in this session; otherwise undefined. */
export function recordNavFromState(state: unknown, entity: string, owner: string): RecordNav | undefined {
  const nav = isObject(state) ? state[RECORD_NAV_STATE_KEY] : undefined;
  if (!isObject(nav) || nav.entity !== entity || typeof nav.owner !== 'string' || nav.owner !== owner) return undefined;
  const { ids, total } = nav;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return undefined;
  if (!ids.every((id): id is string => typeof id === 'string' && UUID.test(id))) return undefined;
  if (new Set(ids).size !== ids.length) return undefined;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < ids.length) return undefined;
  const search = parseListSearch(isObject(nav.search) ? nav.search : {});
  return { entity, ids: [...ids], search, total };
}

/** Where `id` sits in the list the user came from; undefined when the record is not on that page. */
export function recordPosition(nav: RecordNav, id: string): RecordPosition | undefined {
  const index = nav.ids.indexOf(id);
  if (index === -1) return undefined;
  const offset = ((nav.search.page ?? 1) - 1) * PAGE_SIZE;
  const prev = nav.ids[index - 1];
  const next = nav.ids[index + 1];
  return {
    ordinal: offset + index + 1,
    total: nav.total,
    ...(prev ? { prev } : {}),
    ...(next ? { next } : {}),
    prevPage: index === 0 && offset > 0,
    nextPage: index === nav.ids.length - 1 && offset + nav.ids.length < nav.total,
  };
}

/** The criteria of the neighbouring page (page 1 has no `page` key, like the list's own URL). */
export function adjacentSearch(search: ListSearch, direction: 'prev' | 'next'): ListSearch {
  const page = (search.page ?? 1) + (direction === 'next' ? 1 : -1);
  const { page: _page, ...rest } = search;
  return page > 1 ? { ...rest, page } : rest;
}
