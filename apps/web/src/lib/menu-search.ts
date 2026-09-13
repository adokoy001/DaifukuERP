export const DIRECTORY_KINDS = ['workspace', 'record', 'report', 'action', 'setting'] as const;
export type DirectoryKind = typeof DIRECTORY_KINDS[number];
export interface DirectorySearch { q?: string; kind?: DirectoryKind; page?: number }
export type DirectoryPatch = { [Key in keyof DirectorySearch]?: DirectorySearch[Key] | undefined };

/** Bounded URL state makes the browser Back button restore directory filters and pagination. */
export function parseDirectorySearch(raw: Record<string, unknown>): DirectorySearch {
  const q = typeof raw.q === 'string' ? [...raw.q.slice(0, 240)].slice(0, 120).join('').replace(/[\uD800-\uDFFF]/gu, '\uFFFD') : '';
  const kind = DIRECTORY_KINDS.find((candidate) => candidate === raw.kind);
  const page = typeof raw.page === 'number' ? raw.page : typeof raw.page === 'string' && /^\d{1,5}$/.test(raw.page) ? Number(raw.page) : 1;
  return { ...(q ? { q } : {}), ...(kind ? { kind } : {}), ...(Number.isSafeInteger(page) && page > 1 && page <= 10000 ? { page } : {}) };
}
