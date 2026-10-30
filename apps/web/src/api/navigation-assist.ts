// navigation-assist AC-3/AC-4/AC-7: React side of the browser-local recent records and favourites. The lists are
// read through useSyncExternalStore so the sidebar, the screen trail and the palette agree, in this tab (notify)
// and across tabs (the `storage` event). Any storage failure reads as "unavailable" and the lists are not shown.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { assistStorageKey, browserStorage, readRaw, type AssistKind } from '../lib/assist-storage.ts';
import { parseFavorites, toggleStoredFavorite, visibleFavorites, MAX_FAVORITES } from '../lib/favorites.ts';
import type { NavigationCatalog } from '../lib/navigation-types.ts';
import { parseRecentRecords, recentRecordLabel, recordVisit, visibleRecentRecords } from '../lib/recent-records.ts';
import { getCompanyId, getUser } from './client.ts';
import type { EntityMeta, RecordJson } from './types.ts';

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  globalThis.addEventListener?.('storage', listener);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.('storage', listener);
  };
}
function notify() {
  for (const listener of [...listeners]) listener();
}
/** A string snapshot keeps useSyncExternalStore stable without caching; this one means "storage unavailable". */
const UNAVAILABLE = '\u0000unavailable';

/** The signed-in user's tenant and the tab's company; a company switch reloads the page, so this is per render. */
function storageKey(kind: AssistKind): string | undefined {
  const user = getUser();
  return assistStorageKey(kind, {
    tenantId: user?.tenantId ?? '',
    userId: user?.id ?? '',
    companyId: getCompanyId() ?? '',
  });
}
function useStored(kind: AssistKind): string | null | undefined {
  const key = storageKey(kind);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => {
      const raw = readRaw(browserStorage(), key);
      return raw === undefined ? UNAVAILABLE : raw;
    },
    () => UNAVAILABLE,
  );
  return snapshot === UNAVAILABLE ? undefined : snapshot;
}

/** Recent records of the current company whose entity is still in the catalog, newest first. */
export function useRecentRecords(catalog: NavigationCatalog) {
  const raw = useStored('recent');
  const items = useMemo(
    () => (raw === undefined ? [] : visibleRecentRecords(parseRecentRecords(raw), catalog)),
    [raw, catalog],
  );
  return { available: raw !== undefined, items };
}

/** Remembers an opened record (entity, id, display name, time). Silent when the storage refuses. */
export function useRecordVisit(entity: EntityMeta, record: RecordJson | undefined): void {
  const id = record?.id;
  const label = record ? recentRecordLabel(entity, record) : undefined;
  useEffect(() => {
    if (!id) return;
    const visit = { entity: entity.name, id, openedAt: new Date().toISOString(), ...(label ? { label } : {}) };
    if (recordVisit(browserStorage(), storageKey('recent'), visit)) notify();
  }, [entity.name, id, label]);
}

/** Favourite screens of the current company, limited to the catalog; `toggle` reports what happened. */
export function useFavorites(catalog: NavigationCatalog) {
  const raw = useStored('favorites');
  const hrefs = useMemo(() => (raw === undefined ? [] : parseFavorites(raw)), [raw]);
  const entries = useMemo(() => visibleFavorites(hrefs, catalog), [hrefs, catalog]);
  const toggle = useCallback(
    (href: string) => {
      const change = toggleStoredFavorite(browserStorage(), storageKey('favorites'), href, catalog);
      if (change === 'added' || change === 'removed') notify();
      return change;
    },
    [catalog],
  );
  return { available: raw !== undefined, hrefs, entries, toggle, max: MAX_FAVORITES };
}
