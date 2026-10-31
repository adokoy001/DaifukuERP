// navigation-assist AC-4: favourite screens, stored as catalog hrefs per user/tenant/company in this browser.
// Labels are never stored: they come from the current catalog, so a screen the user can no longer open (or one a
// tampered storage names) is simply not shown. Pure; the React side is api/navigation-assist.ts.
import { envelope, parseEnvelope, readRaw, writeRaw, type AssistStorage } from './assist-storage.ts';
import type { NavigationCatalog, NavigationEntry } from './navigation-types.ts';

export const MAX_FAVORITES = 20;
/** An application path: no scheme, host, query, hash, encoded or dot segments. */
const HREF = /^\/(?:[a-z0-9_-]+(?:\.[a-z0-9_-]+)*(?:\/(?!$)|$))*$/i;

export function isFavoriteHref(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && HREF.test(value);
}

export function parseFavorites(raw: string | null | undefined): string[] {
  const hrefs: string[] = [];
  for (const value of parseEnvelope(raw)) {
    if (!isFavoriteHref(value) || hrefs.includes(value)) continue;
    hrefs.push(value);
    if (hrefs.length === MAX_FAVORITES) break;
  }
  return hrefs;
}

/** Favourites in the order they were added, limited to screens the current catalog offers. */
export function visibleFavorites(hrefs: readonly string[], catalog: NavigationCatalog): NavigationEntry[] {
  const entries = new Map(catalog.entries.map((entry) => [entry.href, entry]));
  return hrefs.flatMap((href) => {
    const entry = entries.get(href);
    return entry ? [entry] : [];
  });
}

export type FavoriteChange = 'added' | 'removed' | 'full' | 'invalid';
/**
 * Adds or removes one href. When the list is full, favourites that are not in the current catalog (lost
 * permission) make room first; if every slot is a visible screen, nothing changes and the result is 'full'.
 */
export function toggleFavorite(
  hrefs: readonly string[],
  href: string,
  available: ReadonlySet<string>,
): { change: FavoriteChange; hrefs: string[] } {
  if (!isFavoriteHref(href)) return { change: 'invalid', hrefs: [...hrefs] };
  if (hrefs.includes(href)) return { change: 'removed', hrefs: hrefs.filter((item) => item !== href) };
  const next = [...hrefs];
  while (next.length >= MAX_FAVORITES) {
    const hidden = next.findIndex((item) => !available.has(item));
    if (hidden < 0) return { change: 'full', hrefs: [...hrefs] };
    next.splice(hidden, 1);
  }
  return { change: 'added', hrefs: [...next, href] };
}

/** Toggle against the latest stored list. 'failed' when the storage cannot be read or refuses the write. */
export function toggleStoredFavorite(
  storage: AssistStorage | undefined,
  key: string | undefined,
  href: string,
  catalog: NavigationCatalog,
): FavoriteChange | 'failed' {
  const raw = readRaw(storage, key);
  if (raw === undefined) return 'failed';
  const result = toggleFavorite(parseFavorites(raw), href, new Set(catalog.entries.map((entry) => entry.href)));
  if (result.change !== 'added' && result.change !== 'removed') return result.change;
  return writeRaw(storage, key, envelope(result.hrefs)) ? result.change : 'failed';
}
